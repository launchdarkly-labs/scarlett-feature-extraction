#!/usr/bin/env python3
"""
Train Two-Stage Deal Prediction Model

This script demonstrates how to train a deal prediction model using features
extracted from sales call transcripts.

Usage:
    # With your own labeled data:
    python ml/train_model.py --data your_labeled_data.csv

    # With synthetic demo data:
    python ml/train_model.py --demo
"""

import argparse
import pandas as pd
import numpy as np
from pathlib import Path
from deal_model import TwoStageDealModel
from sklearn.model_selection import train_test_split


def generate_synthetic_training_data(n_samples: int = 1000, close_rate: float = 0.15) -> pd.DataFrame:
    """
    Generate synthetic sales deal data for demonstration.

    In production, you would:
    1. Load extracted transcript features from CSV
    2. Join with CRM data containing actual outcomes (deal_closed, deal_value)
    3. Use real historical data instead of synthetic data
    """
    np.random.seed(42)

    # Simulate extracted features from transcripts (from the extraction pipeline)
    data = pd.DataFrame({
        # Core identity fields
        'transcript_id': [f'transcript_{i}' for i in range(n_samples)],
        'customer_company_name': [f'Company_{i%200}' for i in range(n_samples)],

        # Sentiment features (from transcript extraction)
        'overall_sentiment_score': np.random.normal(0.3, 0.4, n_samples),
        'product_sentiment': np.random.normal(0.4, 0.3, n_samples),
        'pricing_sentiment': np.random.normal(0.1, 0.5, n_samples),
        'competitors_sentiment': np.random.normal(-0.2, 0.3, n_samples),

        # Sentiment trajectory (NEW)
        'sentiment_trajectory': np.random.choice(['improving', 'stable', 'declining', 'unknown'], n_samples, p=[0.25, 0.45, 0.15, 0.15]),

        # Engagement scores (from transcript extraction)
        'customer_engagement_score': np.random.uniform(0, 1, n_samples),
        'urgency_score': np.random.uniform(0, 1, n_samples),
        'budget_confidence_score': np.random.uniform(0, 1, n_samples),

        # Binary signals (from transcript extraction)
        'next_steps_defined': np.random.choice([0, 1], n_samples, p=[0.3, 0.7]),
        'timeline_mentioned': np.random.choice([0, 1], n_samples, p=[0.4, 0.6]),
        'decision_maker_identified': np.random.choice([0, 1], n_samples, p=[0.5, 0.5]),
        'competitors_mentioned': np.random.choice([0, 1], n_samples, p=[0.6, 0.4]),

        # Text statistics (NEW - Phase 1 Quick Wins)
        'transcript_word_count': np.random.lognormal(7.5, 0.5, n_samples).astype(int),  # ~1800 words avg
        'customer_word_count': np.random.lognormal(6.8, 0.5, n_samples).astype(int),  # ~900 words avg
        'customer_question_count': np.random.poisson(8, n_samples),  # ~8 questions avg
        'technical_term_count': np.random.poisson(15, n_samples),  # ~15 technical terms
        'pricing_mention_count': np.random.poisson(3, n_samples),  # ~3 pricing mentions
        'competitor_mention_count': np.random.poisson(2, n_samples),  # ~2 competitor mentions

        # Categorical features
        'call_category': np.random.choice(['prospecting', 'discovery', 'demo', 'proposal', 'technical', 'customer_success'], n_samples),
        'industry': np.random.choice(['Technology', 'Finance', 'Healthcare', 'Retail', 'Manufacturing'], n_samples),
        'customer_size': np.random.choice(['SMB', 'Mid-Market', 'Enterprise'], n_samples, p=[0.5, 0.3, 0.2]),

        # Structured CRM features (would be joined from your CRM)
        'days_in_pipeline': np.random.exponential(45, n_samples).astype(int),
        'touchpoint_count': np.random.poisson(8, n_samples),
        'estimated_deal_value': np.random.lognormal(11, 1.5, n_samples).astype(int),  # ~$50k-$500k range
    })

    # Clip sentiment scores to [-1, 1]
    sentiment_cols = ['overall_sentiment_score', 'product_sentiment', 'pricing_sentiment', 'competitors_sentiment']
    for col in sentiment_cols:
        data[col] = data[col].clip(-1, 1)

    # Ensure realistic ranges for text statistics
    data['transcript_word_count'] = data['transcript_word_count'].clip(200, 10000)
    data['customer_word_count'] = data['customer_word_count'].clip(50, 5000)
    data['customer_question_count'] = data['customer_question_count'].clip(0, 50)
    data['technical_term_count'] = data['technical_term_count'].clip(0, 100)
    data['pricing_mention_count'] = data['pricing_mention_count'].clip(0, 20)
    data['competitor_mention_count'] = data['competitor_mention_count'].clip(0, 10)

    # Generate target: deal_closed (influenced by features)
    close_score = (
        0.3 * data['overall_sentiment_score'] +
        0.2 * data['customer_engagement_score'] +
        0.15 * data['urgency_score'] +
        0.15 * data['budget_confidence_score'] +
        0.1 * data['next_steps_defined'] +
        0.05 * data['timeline_mentioned'] +
        0.05 * data['decision_maker_identified'] +
        np.random.normal(0, 0.2, n_samples)
    )

    # Convert to probability and sample
    close_prob = 1 / (1 + np.exp(-close_score * 3 + np.log(1/close_rate - 1)))
    data['deal_closed'] = (np.random.random(n_samples) < close_prob).astype(int)

    # Generate deal value (for closed deals, influenced by estimated value + sentiment)
    value_multiplier = (
        1.0 +
        0.3 * data['product_sentiment'].clip(0, 1) +
        0.2 * data['customer_engagement_score'] -
        0.15 * np.abs(data['pricing_sentiment'])  # Pricing concerns reduce value
    )

    data['deal_value'] = np.where(
        data['deal_closed'] == 1,
        data['estimated_deal_value'] * value_multiplier * np.random.lognormal(0, 0.3, n_samples),
        0
    ).astype(int)

    print(f"\n📊 Synthetic Data Statistics:")
    print(f"  Total samples: {n_samples:,}")
    print(f"  Deals closed: {data['deal_closed'].sum():,} ({data['deal_closed'].mean()*100:.1f}%)")
    print(f"  Deals lost/open: {(1-data['deal_closed']).sum():,} ({(1-data['deal_closed']).mean()*100:.1f}%)")
    print(f"  Total deal value: ${data['deal_value'].sum():,}")
    print(f"  Avg value (closed deals): ${data[data['deal_closed']==1]['deal_value'].mean():,.0f}")

    return data


def prepare_features(df: pd.DataFrame) -> tuple:
    """
    Prepare features and targets for model training.

    Returns:
    --------
    X : DataFrame
        Feature matrix
    y_close : Series
        Binary target (deal closed)
    y_value : Series
        Deal values
    cat_features : list
        Names of categorical features
    """
    # Define feature columns
    sentiment_features = [
        'overall_sentiment_score',
        'product_sentiment',
        'pricing_sentiment',
        'competitors_sentiment'
    ]

    engagement_features = [
        'customer_engagement_score',
        'urgency_score',
        'budget_confidence_score'
    ]

    signal_features = [
        'next_steps_defined',
        'timeline_mentioned',
        'decision_maker_identified',
        'competitors_mentioned'
    ]

    text_statistics = [
        'transcript_word_count',
        'customer_word_count',
        'customer_question_count',
        'technical_term_count',
        'pricing_mention_count',
        'competitor_mention_count'
    ]

    categorical_features = [
        'call_category',
        'industry',
        'customer_size',
        'sentiment_trajectory'
    ]

    structured_features = [
        'days_in_pipeline',
        'touchpoint_count',
        'estimated_deal_value'
    ]

    feature_cols = (
        sentiment_features +
        engagement_features +
        signal_features +
        text_statistics +
        categorical_features +
        structured_features
    )

    X = df[feature_cols].copy()
    y_close = df['deal_closed']
    y_value = df['deal_value']

    return X, y_close, y_value, categorical_features


def train_and_evaluate(data: pd.DataFrame, test_size: float = 0.2):
    """Train and evaluate the two-stage deal prediction model."""

    print("\n" + "=" * 80)
    print("PREPARING DATA")
    print("=" * 80)

    X, y_close, y_value, cat_features = prepare_features(data)

    # Split data
    X_train, X_test, y_close_train, y_close_test, y_value_train, y_value_test = train_test_split(
        X, y_close, y_value,
        test_size=test_size,
        random_state=42,
        stratify=y_close
    )

    print(f"\n📊 Data Split:")
    print(f"  Training samples: {len(X_train):,}")
    print(f"  Test samples: {len(X_test):,}")
    print(f"  Training close rate: {y_close_train.mean()*100:.1f}%")
    print(f"  Test close rate: {y_close_test.mean()*100:.1f}%")

    # Initialize and train model
    print("\n" + "=" * 80)
    print("TRAINING TWO-STAGE MODEL")
    print("=" * 80 + "\n")

    model = TwoStageDealModel(
        cat_features=cat_features,
        classifier_params={'verbose': 100},
        regressor_params={'verbose': 100}
    )

    model.fit(
        X_train,
        y_close_train,
        y_value_train,
        eval_set=(X_test, y_close_test, y_value_test)
    )

    # Evaluate model
    print("\n" + "=" * 80)
    print("MODEL EVALUATION")
    print("=" * 80)

    metrics = model.evaluate(X_test, y_close_test, y_value_test, beta=2.0)

    print("\n📈 Classification Metrics (Stage 1 - Deal Close Prediction):")
    print(f"  ROC-AUC Score: {metrics['roc_auc']:.4f}")
    print(f"  PR-AUC Score: {metrics['pr_auc']:.4f}")
    print(f"  F2 Score: {metrics['f2.0_score']:.4f}  👈 OPTIMIZES FOR RECALL (catch more potential deals)")
    print(f"  Close Rate - Actual: {metrics['close_rate_actual']*100:.1f}%")
    print(f"  Close Rate - Predicted: {metrics['close_rate_predicted']*100:.1f}%")

    print("\n💰 Regression Metrics (Stage 2 - Deal Value Prediction):")
    print(f"  RMSE (Closed Deals): ${metrics['rmse_closed_deals']:,.0f}")
    print(f"  MAE (Closed Deals): ${metrics['mae_closed_deals']:,.0f}")
    print(f"  R² (Closed Deals): {metrics['r2_closed_deals']:.4f}")

    print("\n🎯 Overall Performance:")
    print(f"  RMSE (All Deals): ${metrics['rmse_overall']:,.0f}")
    print(f"  MAE (All Deals): ${metrics['mae_overall']:,.0f}")

    print("\n💼 Business Metrics:")
    print(f"  Total Actual Value: ${metrics['total_actual_value']:,.0f}")
    print(f"  Total Predicted Value: ${metrics['total_predicted_value']:,.0f}")
    print(f"  Prediction Error: {metrics['value_error_pct']:+.1f}%")

    # Feature importance
    print("\n" + "=" * 80)
    print("FEATURE IMPORTANCE")
    print("=" * 80)

    clf_importance, reg_importance = model.get_feature_importance()

    print("\n🔍 Top 10 Features for Predicting Deal Close (Stage 1):")
    print(clf_importance.head(10).to_string(index=False))

    print("\n💵 Top 10 Features for Predicting Deal Value (Stage 2):")
    print(reg_importance.head(10).to_string(index=False))

    # Sample predictions
    print("\n" + "=" * 80)
    print("SAMPLE PREDICTIONS")
    print("=" * 80)

    expected_value, p_close, value_if_closed = model.predict(X_test.head(10), return_components=True)

    print("\n📋 First 10 test samples:")
    print(f"{'Deal #':<8} {'P(Close)':<10} {'Value|Close':<15} {'Expected Value':<15} {'Actual Close':<12} {'Actual Value':<12}")
    print("-" * 90)

    for i in range(10):
        print(f"{i+1:<8} {p_close[i]:>8.1%}  ${value_if_closed[i]:>12,.0f}  ${expected_value[i]:>13,.0f}  {'✓ Closed' if y_close_test.iloc[i] else '✗ Lost':<12} ${y_value_test.iloc[i]:>10,.0f}")

    return model, metrics


def main():
    parser = argparse.ArgumentParser(description='Train two-stage deal prediction model')
    parser.add_argument('--data', type=str, help='Path to labeled training data CSV')
    parser.add_argument('--demo', action='store_true', help='Use synthetic demo data')
    parser.add_argument('--samples', type=int, default=1000, help='Number of synthetic samples (if --demo)')

    args = parser.parse_args()

    print("=" * 80)
    print("🤖 TWO-STAGE DEAL PREDICTION MODEL - TRAINING")
    print("=" * 80)

    if args.demo or not args.data:
        print("\n🎲 Generating synthetic training data...")
        data = generate_synthetic_training_data(n_samples=args.samples)
    else:
        print(f"\n📁 Loading training data from: {args.data}")
        data = pd.read_csv(args.data)

    # Train and evaluate
    model, metrics = train_and_evaluate(data)

    # Save model
    output_dir = Path(__file__).parent / "models"
    output_dir.mkdir(exist_ok=True)

    model_path = output_dir / "deal_model_latest.cbm"
    print(f"\n💾 Saving model to: {model_path}")

    # Note: In production, you'd save both models separately
    # For now, we'll just note this in the output
    print("   ℹ️  To save CatBoost models, use:")
    print("      model.classifier.save_model('classifier.cbm')")
    print("      model.regressor.save_model('regressor.cbm')")

    print("\n" + "=" * 80)
    print("✨ TRAINING COMPLETE!")
    print("=" * 80)
    print("\n💡 Next Steps:")
    print("  1. Review feature importance to understand key drivers")
    print("  2. Adjust features or model parameters if needed")
    print("  3. Test on real extracted transcript data")
    print("  4. Deploy model to score new deals in production")
    print(f"\n🎯 Key Metric: F2 Score = {metrics['f2.0_score']:.4f}")
    print("   (F2 weights recall 2x more than precision - catches more potential deals)")


if __name__ == "__main__":
    main()
