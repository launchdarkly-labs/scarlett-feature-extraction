# ML Pipeline: Two-Stage Deal Prediction Model

Machine learning pipeline for predicting sales deal outcomes using features extracted from call transcripts.

## Overview

This ML pipeline implements a **two-stage zero-inflated model** specifically designed for B2B sales data where:
- **90-95% of deals don't close** (high zero rate)
- Closed deals have **varying values** ($10k-$1M+)
- Traditional single regressors **struggle with this distribution**

### Two-Stage Approach

```
Stage 1 (Classifier): P(deal closes) → Binary prediction
Stage 2 (Regressor): E[deal_value | closed] → Value given closure
Final Prediction: P(close) × E[value | closed]
```

**Why this works better:**
- ✅ Handles zero-inflated distributions naturally
- ✅ Separates "will it close?" from "how much is it worth?"
- ✅ More accurate than single-stage regression
- ✅ Provides interpretable probabilities

## Quick Start

### 1. Install Dependencies

```bash
# Recommended: Use requirements.txt
pip install -r ml/requirements.txt

# Or install individually:
pip install catboost scikit-learn pandas numpy matplotlib
```

### 2. Train with Demo Data

```bash
python ml/train_model.py --demo
```

### 3. Train with Your Data

```bash
# Your CSV must have these columns:
# - Extracted features (from transcript extraction pipeline)
# - deal_closed (0 or 1)
# - deal_value (dollar amount, 0 if not closed)

python ml/train_model.py --data your_labeled_deals.csv
```

## Features Used

### From Transcript Extraction Pipeline

These features are automatically extracted from sales call transcripts:

**Sentiment Features** (continuous, -1 to +1):
- `overall_sentiment_score`
- `product_sentiment`
- `pricing_sentiment`
- `competitors_sentiment`

**Engagement Scores** (continuous, 0 to 1):
- `customer_engagement_score`
- `urgency_score`
- `budget_confidence_score`

**Binary Signals** (0 or 1):
- `next_steps_defined`
- `timeline_mentioned`
- `decision_maker_identified`
- `competitors_mentioned`

**Text Statistics** (integers):
- `transcript_word_count` - Total words in transcript
- `customer_word_count` - Estimated customer speaking time
- `customer_question_count` - Number of questions asked
- `technical_term_count` - Technical depth indicator
- `pricing_mention_count` - Pricing discussion frequency
- `competitor_mention_count` - Competitive landscape mentions

**Momentum Indicator**:
- `sentiment_trajectory` (improving, stable, declining, unknown)

**Categorical**:
- `call_category` (prospecting, discovery, demo, proposal, technical, customer_success)
- `industry`
- `customer_size` (SMB, Mid-Market, Enterprise)

### From CRM Data

Join extracted features with your CRM data:

- `days_in_pipeline`
- `touchpoint_count`
- `estimated_deal_value`

## Model Performance

### Evaluation Metrics

**Stage 1 (Classification):**
- ROC-AUC: Overall ranking quality
- PR-AUC: Precision-recall tradeoff
- **F2 Score**: Optimizes for recall (β=2 weights recall 2x more than precision)

**Stage 2 (Regression):**
- RMSE: Root mean squared error on closed deals
- MAE: Mean absolute error on closed deals
- R²: Explained variance

**Business Metrics:**
- Total predicted vs actual deal value
- Value prediction error %

### Why F2 Score?

F2 score (β=2) **emphasizes recall over precision**:
- ✅ Better to **catch more potential deals** (high recall)
- ✅ Missing a deal is worse than false alarm (low precision acceptable)
- ✅ Standard in sales/marketing where opportunity cost is high

## File Structure

```
ml/
├── README.md              # This file
├── deal_model.py          # Two-stage model class
├── train_model.py         # Training script
└── models/                # Saved models (created on first run)
    ├── classifier.cbm
    └── regressor.cbm
```

## Usage Examples

### Training

```python
from deal_model import TwoStageDealModel
import pandas as pd

# Load data
data = pd.read_csv("extracted_features.csv")

# Prepare features
X = data[feature_columns]
y_close = data['deal_closed']
y_value = data['deal_value']

# Train model
model = TwoStageDealModel(cat_features=['industry', 'call_category', 'customer_size', 'sentiment_trajectory'])
model.fit(X, y_close, y_value)

# Evaluate
metrics = model.evaluate(X_test, y_close_test, y_value_test, beta=2.0)
print(f"F2 Score: {metrics['f2.0_score']:.4f}")
```

### Prediction

```python
# Predict on new deals
expected_value, p_close, value_if_closed = model.predict(X_new, return_components=True)

# Get just close probability
p_close = model.predict_close_probability(X_new)

# Rank deals by expected value
deals_ranked = pd.DataFrame({
    'deal_id': deal_ids,
    'p_close': p_close,
    'expected_value': expected_value
}).sort_values('expected_value', ascending=False)
```

### Feature Importance

```python
clf_importance, reg_importance = model.get_feature_importance()

print("Top drivers of deal closure:")
print(clf_importance.head(10))

print("\nTop drivers of deal value:")
print(reg_importance.head(10))
```

## Integration with Transcript Extraction

### End-to-End Workflow

```
1. Extract Features from Transcripts
   ↓
   app/api/extract-stream/route.ts → CSV with sentiment, signals, etc.

2. Join with CRM Data
   ↓
   extracted_features.csv + crm_deals.csv → training_data.csv

3. Train Model
   ↓
   python ml/train_model.py --data training_data.csv

4. Predict on New Deals
   ↓
   New transcript → Extract features → Score with model → Deal prioritization
```

### Example: Joining Data

```python
import pandas as pd

# Load extracted transcript features
transcript_features = pd.read_csv("extracted_features.csv")

# Load CRM data with outcomes
crm_data = pd.read_csv("crm_deals.csv")

# Join on transcript_id (or opportunity_id)
training_data = crm_data.merge(
    transcript_features[[
        'transcript_id',
        'overall_sentiment_score',
        'customer_engagement_score',
        'urgency_score',
        'budget_confidence_score',
        'next_steps_defined',
        'timeline_mentioned',
        'decision_maker_identified',
        'transcript_word_count',
        'customer_word_count',
        'customer_question_count',
        'technical_term_count',
        'pricing_mention_count',
        'competitor_mention_count',
        'sentiment_trajectory',
        'call_category',
        'industry',
        'customer_size'
    ]],
    left_on='opportunity_id',
    right_on='transcript_id',
    how='left'
)

# Now train the model
X = training_data[feature_columns]
y_close = training_data['deal_closed']
y_value = training_data['deal_value']
```

## Model Tuning

### Adjusting for Your Data

**If close rate is very low (<5%):**
```python
model = TwoStageDealModel(
    classifier_params={
        'auto_class_weights': 'SqrtBalanced',  # Less aggressive balancing
        'iterations': 1000  # More iterations
    }
)
```

**If closed deal values have extreme outliers:**
```python
model = TwoStageDealModel(
    regressor_params={
        'loss_function': 'MAE',  # More robust to outliers than RMSE
    }
)
```

**To optimize for different recall/precision tradeoff:**
```python
# F1 (balanced): beta=1
# F2 (favor recall): beta=2  ← Default for sales
# F0.5 (favor precision): beta=0.5

metrics = model.evaluate(X_test, y_close_test, y_value_test, beta=1.0)
```

## Production Deployment

### Deployment Options

**Option 1: Serverless API (Current)**
- Runs Python synchronously via Next.js API route
- Add timeout handling for production
- Consider async task queue (e.g., Vercel Cron, BullMQ)

**Option 2: Separate ML Service**
Deploy as a standalone Python service:

```python
# ml_service.py
from fastapi import FastAPI
from deal_model import TwoStageDealModel
import joblib

app = FastAPI()

@app.post("/predict")
async def predict(features: dict):
    model = joblib.load("models/deal_model.pkl")
    prediction = model.predict(features)
    return {"expected_value": prediction}
```

**Option 3: Edge Deployment with ONNX**
Convert models for browser/edge execution:

```python
# Convert to ONNX format
model.classifier.save_model("classifier.onnx", format="onnx")
model.regressor.save_model("regressor.onnx", format="onnx")

# Then use onnxruntime-web in JavaScript
```

### Saving and Loading Models

```python
# Save
model.classifier.save_model('ml/models/classifier.cbm')
model.regressor.save_model('ml/models/regressor.cbm')

# Load
from catboost import CatBoostClassifier, CatBoostRegressor

classifier = CatBoostClassifier()
classifier.load_model('ml/models/classifier.cbm')

regressor = CatBoostRegressor()
regressor.load_model('ml/models/regressor.cbm')

# Reconstruct TwoStageDealModel
model = TwoStageDealModel(cat_features=['industry', 'call_category', 'customer_size', 'sentiment_trajectory'])
model.classifier = classifier
model.regressor = regressor
model._fitted = True
```

### API Integration

Add to your Next.js app:

```typescript
// app/api/score-deal/route.ts
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export async function POST(request: Request) {
  const features = await request.json();

  // Call Python model
  const { stdout } = await execPromise(
    `python ml/predict.py '${JSON.stringify(features)}'`
  );

  const prediction = JSON.parse(stdout);

  return Response.json({
    p_close: prediction.p_close,
    expected_value: prediction.expected_value
  });
}
```

## Cost Considerations

**Training Costs:**
- Free (runs locally)
- Training time: ~1-5 minutes for 1,000-10,000 deals

**Inference Costs:**
- Near-zero (CatBoost is fast: ~1ms per prediction)
- Can score 1,000s of deals per second

**Feature Extraction Costs:**
- See main README for transcript extraction costs
- Typical: $0.001-$0.03 per transcript

## Performance Benchmarks

**Note:** These are estimates using synthetic data. Real performance will vary based on:
- Data quality and quantity
- Feature engineering
- Business domain specifics
- Close rate distribution

**Synthetic Data Results** (500 samples, 15% close rate):
- Training Time: 5-15 seconds
- F2 Score: Typically 70-85%
- ROC-AUC: Typically 80-92%
- Value Prediction Error: Typically ±5-15%

**Minimum Data Requirements:**
- Absolute minimum: 50 closed deals
- Recommended: 150+ closed deals
- Ideal: 500+ closed deals

## References

- [CatBoost Documentation](https://catboost.ai/docs/)
- [Zero-Inflated Models](https://en.wikipedia.org/wiki/Zero-inflated_model)
- [F-beta Score](https://en.wikipedia.org/wiki/F-score)
- [Two-Stage Modeling for Count Data](https://stats.stackexchange.com/questions/81457/what-is-the-difference-between-zero-inflated-and-hurdle-models)

## Troubleshooting

**"Not enough closed deals to train regressor"**
→ You need at least 10 closed deals with known values
→ Collect more labeled data or adjust close_rate in synthetic data

**"Feature importance shows unexpected results"**
→ Check for data leakage (features that wouldn't be available at prediction time)
→ Review feature engineering and ensure transcript features are properly extracted

**"Model predicts close rate too high/low"**
→ CatBoost auto_class_weights may need tuning
→ Check if train/test split is stratified by deal_closed

**"Poor performance on new data"**
→ Ensure new data has same feature distributions as training data
→ Retrain periodically as call patterns evolve
→ Check for missing values in categorical features
