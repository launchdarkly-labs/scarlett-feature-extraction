# Why Standard Regression Fails for Sales Data (And How to Fix It with Two-Stage Models)

**Most sales deals don't close. That's not pessimism, it's math. This breaks standard ML models, so I built a two-stage architecture that actually works, deployed on Vercel's edge infrastructure.**

When I first tried to build ML models for sales forecasting, I did what seemed obvious: take historical deal data, extract features using the pipeline from Part 1, train a regression model to predict deal values. The model metrics looked decent enough. Then I deployed it to production on Vercel Functions and the forecasts were consistently way off. Like, embarrassingly wrong.

The problem? Look at your typical sales data distribution:

```python
import pandas as pd
import numpy as np

# Load actual sales outcomes
data = pd.read_csv('sales_data.csv')

# Check the distribution
closed_deals = (data['deal_value'] > 0).sum()
total_deals = len(data)
close_rate = closed_deals / total_deals

print(f"Total deals: {total_deals}")
print(f"Closed deals: {closed_deals} ({close_rate:.1%})")
print(f"Lost/abandoned deals: {total_deals - closed_deals} ({1-close_rate:.1%})")

# The output will probably look like:
# Total deals: 1000
# Closed deals: 147 (14.7%)
# Lost/abandoned deals: 853 (85.3%)
```

When 85% of your target values are zero, standard regression does weird things. It tries to find a middle ground, predicting small positive values for deals that have zero chance of closing. Multiply that error by hundreds of deals and your pipeline forecast becomes fiction.

Sales isn't one decision - it's two: will this deal close at all (binary), and if it closes, what's it worth (continuous)? Standard regression conflates these. A two-stage model respects the actual process:

```
Stage 1: Classify → P(deal closes)
Stage 2: Regress → E[value | deal closes]
Final: Combine → E[value] = P(close) × E[value|closed]
```

This isn't just theoretically cleaner, it should perform better because each model can focus on its specific problem. The implementation uses CatBoost (which handles categorical features from our LaunchDarkly-powered extraction beautifully):

```python
# ml/deal_model.py
import numpy as np
from catboost import CatBoostClassifier, CatBoostRegressor
from sklearn.base import BaseEstimator, RegressorMixin

class TwoStageDealModel(BaseEstimator, RegressorMixin):
    """
    Two-stage model for sales deal prediction.

    Why two stages?
    Stage 1 learns which deals close (imbalanced classification)
    Stage 2 learns values only from closed deals (no zeros)
    Combined: realistic expected values
    """

    def __init__(self, cat_features=None):
        # Stage 1: Binary classifier
        self.classifier = CatBoostClassifier(
            iterations=500,
            learning_rate=0.1,
            depth=6,
            loss_function='Logloss',
            auto_class_weights='Balanced',  # Key for imbalanced data
            verbose=False,
            random_seed=42
        )

        # Stage 2: Value regressor
        self.regressor = CatBoostRegressor(
            iterations=500,
            learning_rate=0.1,
            depth=8,
            loss_function='RMSE',
            verbose=False,
            random_seed=42
        )

        self.cat_features = cat_features or []

    def fit(self, X, y_close, y_value):
        """
        Train both stages.

        Stage 2 only trains on closed deals!
        """
        # Stage 1: All deals
        print(f"Stage 1: Training classifier on {len(X)} deals")
        print(f"  Close rate: {y_close.mean():.1%}")

        self.classifier.fit(
            X, y_close,
            cat_features=self.cat_features
        )

        # Stage 2: Only closed deals
        closed_mask = y_close == 1
        X_closed = X[closed_mask]
        y_value_closed = y_value[closed_mask]

        print(f"\nStage 2: Training regressor on {len(X_closed)} closed deals")

        if len(X_closed) < 50:
            print("⚠️  Warning: Less than 50 closed deals for training")
            print("    Model may be unreliable")

        self.regressor.fit(
            X_closed,
            y_value_closed,
            cat_features=self.cat_features
        )

        return self

    def predict(self, X, return_components=False):
        """
        Generate predictions.

        Returns expected value = P(close) × E[value|closed]
        """
        # Get probability of closing
        p_close = self.classifier.predict_proba(X)[:, 1]

        # Get expected value if closed
        value_if_closed = self.regressor.predict(X)
        value_if_closed = np.maximum(0, value_if_closed)  # No negative deals

        # Calculate expected value
        expected_value = p_close * value_if_closed

        if return_components:
            # Useful for understanding predictions
            return expected_value, p_close, value_if_closed

        return expected_value
```

## Metrics That Actually Matter

For the classification stage, don't optimize for accuracy:

```python
from sklearn.metrics import f1_score, fbeta_score, accuracy_score

# Typical sales data
y_true = [0] * 850 + [1] * 150  # 15% close rate

# Model that predicts everything as "won't close"
y_pred_conservative = [0] * 1000

print(f"Accuracy: {accuracy_score(y_true, y_pred_conservative):.1%}")  # 85%!
print(f"F1 Score: {f1_score(y_true, y_pred_conservative):.1%}")        # 0%

# That 85% accuracy is useless because it catches zero deals!
```

Instead, I use F2 score (or another F-beta score) which can weight recall more than precision:

```python
# F2 = (1 + 2²) × (precision × recall) / (2² × precision + recall)
# This prioritizes catching potential deals over being precisely right

fbeta_score(y_true, y_pred, beta=2.0)  # Weights recall 2x more than precision
```

In sales, missing a potential deal is typically worse than qualifying a few extra leads. Based on the model architecture and features extracted via the Vercel AI SDK pipeline, I'd expect different features to matter for each stage:

```python
def get_feature_importance(model):
    # Get importance from both stages
    clf_importance = model.classifier.feature_importances_
    reg_importance = model.regressor.feature_importances_

    feature_names = model.classifier.feature_names_

    # Create DataFrames for easy viewing
    clf_df = pd.DataFrame({
        'feature': feature_names,
        'importance': clf_importance
    }).sort_values('importance', ascending=False)

    reg_df = pd.DataFrame({
        'feature': feature_names,
        'importance': reg_importance
    }).sort_values('importance', ascending=False)

    return clf_df, reg_df
```

Theoretically, Stage 1 (Close Probability) should care about engagement signals from our extraction: urgency_score, next_steps_defined, sentiment_trajectory. Stage 2 (Deal Value) should care about company characteristics: customer_size, industry, technical_term_count. The features that predict "will it close?" are likely different from "how much is it worth?", and that's exactly what our LaunchDarkly-configured extraction captures.

## Deploying to Production

I deploy the trained model as a Vercel Function for real-time scoring:

```typescript
// api/score-deal/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';

export const runtime = 'nodejs';  // Python subprocess requires Node runtime

export async function POST(request: NextRequest) {
  const features = await request.json();

  // Call Python model via subprocess
  return new Promise((resolve, reject) => {
    const python = spawn('python3', ['ml/score_deal.py']);

    python.stdin.write(JSON.stringify(features));
    python.stdin.end();

    let output = '';
    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.on('close', (code) => {
      if (code === 0) {
        const prediction = JSON.parse(output);

        // Track with Vercel Analytics
        track('deal_scored', {
          p_close: prediction.p_close,
          expected_value: prediction.expected_value,
        });

        resolve(NextResponse.json(prediction));
      } else {
        reject(new Error(`Python process exited with code ${code}`));
      }
    });
  });
}
```

The Python scoring script loads the pre-trained model:

```python
# ml/score_deal.py
import sys
import json
import joblib
import pandas as pd

# Load model once at module level
model = joblib.load('ml/models/deal_model.pkl')

def score_deal(features):
    # Convert to DataFrame
    X = pd.DataFrame([features])

    # Get predictions
    expected_value, p_close, value_if_closed = model.predict(
        X, return_components=True
    )

    return {
        'p_close': float(p_close[0]),
        'value_if_closed': float(value_if_closed[0]),
        'expected_value': float(expected_value[0])
    }

if __name__ == '__main__':
    features = json.loads(sys.stdin.read())
    result = score_deal(features)
    print(json.dumps(result))
```

Deploy with `vercel --prod` and your model is available globally on Vercel's edge network, with automatic scaling and monitoring.

Gradient boosting models often output overconfident probabilities. When the model says 90% chance of closing, it might really be closer to 70%. Calibration helps:

```python
from sklearn.calibration import CalibratedClassifierCV

# After training the base model
calibrated = CalibratedClassifierCV(
    base_estimator=model.classifier,
    method='sigmoid',
    cv=3
)

calibrated.fit(X_train, y_close_train)

# Now calibrated.predict_proba gives more reliable probabilities
```

To check if calibration helped:

```python
from sklearn.calibration import calibration_curve
import matplotlib.pyplot as plt

def plot_calibration(y_true, p_uncalibrated, p_calibrated):
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10, 4))

    # Uncalibrated
    frac_pos, mean_pred = calibration_curve(y_true, p_uncalibrated, n_bins=10)
    ax1.plot(mean_pred, frac_pos, 'o-', label='Model')
    ax1.plot([0, 1], [0, 1], 'k--', label='Perfect')
    ax1.set_title('Before Calibration')
    ax1.legend()

    # Calibrated
    frac_pos, mean_pred = calibration_curve(y_true, p_calibrated, n_bins=10)
    ax2.plot(mean_pred, frac_pos, 'o-', label='Model', color='green')
    ax2.plot([0, 1], [0, 1], 'k--', label='Perfect')
    ax2.set_title('After Calibration')
    ax2.legend()

    plt.show()
```

Once deployed, I monitor the model using Vercel's built-in analytics:

```typescript
import { track } from '@vercel/analytics';
import { trace } from '@vercel/otel';

// Track predictions
export async function scoreDeal(features: DealFeatures) {
  return trace(
    'score-deal',
    async (span) => {
      span.setAttributes({
        'deal.size': features.estimated_deal_value,
        'deal.stage': features.deal_stage,
      });

      const prediction = await model.predict(features);

      // Track business metrics
      track('deal_scored', {
        p_close: prediction.p_close,
        expected_value: prediction.expected_value,
        model_version: MODEL_VERSION,
      });

      // Monitor for drift
      if (prediction.p_close > 0.9 && features.urgency_score < 0.3) {
        track('potential_model_drift', {
          reason: 'high_confidence_low_urgency',
          deal_id: features.transcript_id,
        });
      }

      return prediction;
    }
  );
}
```

Vercel automatically collects response times and latency percentiles, error rates and types, geographic distribution of requests, and custom business metrics via Analytics.

Why does this architecture work better? Standard regression (single model) has to learn from 85% zeros, predictions get pulled toward zero but not all the way, resulting in many false positive small values. The two-stage model lets Stage 1 properly learn the imbalanced classification, Stage 2 only sees real deal values (no zeros), and can confidently predict $0 for unlikely deals. By separating "will it close?" from "what's it worth?", each model can specialize in its task. Combined with features extracted via the Vercel AI SDK pipeline from Part 1, you get a complete system.

I monitor these signals using Vercel's monitoring: validation metrics degrading over time, distribution of features shifting significantly (detected via Vercel Analytics), business process changes (new sales methodology), or it's been 90+ days since last training. Set up monitoring for calibration drift (predicted vs actual close rates diverging), feature drift (new data looks different from training data), and performance degradation on holdout sets. I typically retrain monthly with new data, triggered by Vercel Cron:

```typescript
// api/cron/retrain-model/route.ts
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes for training

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Trigger retraining
  const result = await retrainModel();

  return Response.json({
    success: true,
    metrics: result.metrics,
    timestamp: new Date().toISOString()
  });
}
```

## Data Requirements and Integration

How much data do you actually need? The theoretical answer: you want about 10 examples per feature for the model to learn patterns effectively. With the 25 features we extract via the LaunchDarkly-configured pipeline from Part 1, you ideally want 250 closed deals for solid model performance.

But there's a catch. If your close rate is 15% (typical for B2B sales), you need ~1,700 total transcripts to get those 250 closed deals. The practical minimums:
- **Absolute minimum**: 50 closed deals (model will be very rough but can provide directional insights)
- **Decent model**: 150+ closed deals (usable for pipeline forecasting)
- **Good model**: 500+ closed deals (reliable for individual deal scoring)

The good news is you can start with what you have. Even with just 50 closed deals, the two-stage architecture will give you better results than standard regression on zero-inflated data.

This model seamlessly integrates with the extraction pipeline from Part 1:

```python
# Complete workflow
import pandas as pd
from extract_features import extract_via_vercel
from deal_model import TwoStageDealModel

# 1. Extract features from new transcripts using Vercel AI SDK
features = extract_via_vercel(transcripts, schema_from_launchdarkly)

# 2. Score with two-stage model
model = TwoStageDealModel.load('models/production.pkl')
predictions = model.predict(features)

# 3. Push to CRM
for transcript_id, p_close, expected_value in predictions:
    crm.update_opportunity(
        transcript_id,
        win_probability=p_close,
        forecasted_value=expected_value
    )
```

## What I've Built

This two-stage architecture respects the zero-inflated nature of sales data, allows each model to optimize for its specific task, provides interpretable outputs (probability and value separately), integrates seamlessly with the Vercel AI SDK extraction pipeline, and deploys globally on Vercel's infrastructure with built-in monitoring. I haven't trained this on massive real data yet, but the architecture addresses the fundamental problems with using standard regression on sales data while leveraging modern infrastructure for scale.

Most sales deals don't close. That's not a bug in your data, it's the reality of sales. Standard regression models aren't built for this kind of zero-inflated data. The complete solution: extract features with Vercel AI SDK and LaunchDarkly (Part 1), train two-stage models that handle zero-inflation (this post), deploy globally on Vercel Functions with monitoring, and iterate quickly using LaunchDarkly for schema evolution.

The two-stage approach models how sales actually works. First figure out if a deal will close, then predict the value for deals that will close, and combine them probabilistically. Next time you're building ML for sales data, remember: those zeros aren't noise, they're the majority of your data. Build accordingly, deploy on infrastructure that scales, and iterate based on what you learn.

**Get the code:** Full implementation available on GitHub, including the extraction pipeline from Part 1 and deployment configs for Vercel.

*Have questions or tried this approach? Let me know what you find on Twitter.*