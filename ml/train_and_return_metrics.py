#!/usr/bin/env python3
"""
Train model and return metrics as JSON (for API consumption)

Usage:
    python ml/train_and_return_metrics.py --csv extracted_features.csv
    python ml/train_and_return_metrics.py --demo --samples 500
"""

import argparse
import json
import sys
import pandas as pd
import numpy as np
from pathlib import Path
from deal_model import TwoStageDealModel
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_curve, precision_recall_curve


def generate_synthetic_training_data(n_samples: int = 500, close_rate: float = 0.15) -> pd.DataFrame:
    """Generate synthetic sales deal data for demonstration."""
    np.random.seed(42)

    data = pd.DataFrame({
        'transcript_id': [f'transcript_{i}' for i in range(n_samples)],
        'customer_company_name': [f'Company_{i%100}' for i in range(n_samples)],

        # Sentiment features
        'overall_sentiment_score': np.random.normal(0.3, 0.4, n_samples),
        'product_sentiment': np.random.normal(0.4, 0.3, n_samples),
        'pricing_sentiment': np.random.normal(0.1, 0.5, n_samples),
        'competitors_sentiment': np.random.normal(-0.2, 0.3, n_samples),

        # Sentiment trajectory (NEW)
        'sentiment_trajectory': np.random.choice(['improving', 'stable', 'declining', 'unknown'], n_samples, p=[0.25, 0.45, 0.15, 0.15]),

        # Engagement scores
        'customer_engagement_score': np.random.uniform(0, 1, n_samples),
        'urgency_score': np.random.uniform(0, 1, n_samples),
        'budget_confidence_score': np.random.uniform(0, 1, n_samples),

        # Binary signals
        'next_steps_defined': np.random.choice([0, 1], n_samples, p=[0.3, 0.7]),
        'timeline_mentioned': np.random.choice([0, 1], n_samples, p=[0.4, 0.6]),
        'decision_maker_identified': np.random.choice([0, 1], n_samples, p=[0.5, 0.5]),
        'competitors_mentioned': np.random.choice([0, 1], n_samples, p=[0.6, 0.4]),

        # Text statistics (NEW)
        'transcript_word_count': np.random.lognormal(7.5, 0.5, n_samples).astype(int),  # ~1800 words avg
        'customer_word_count': np.random.lognormal(6.8, 0.5, n_samples).astype(int),  # ~900 words avg
        'customer_question_count': np.random.poisson(8, n_samples),  # ~8 questions avg
        'technical_term_count': np.random.poisson(15, n_samples),  # ~15 technical terms
        'pricing_mention_count': np.random.poisson(3, n_samples),  # ~3 pricing mentions
        'competitor_mention_count': np.random.poisson(2, n_samples),  # ~2 competitor mentions

        # Categorical
        'call_category': np.random.choice(['prospecting', 'discovery', 'demo', 'proposal', 'technical', 'customer_success'], n_samples),
        'industry': np.random.choice(['Technology', 'Finance', 'Healthcare', 'Retail', 'Manufacturing'], n_samples),
        'customer_size': np.random.choice(['SMB', 'Mid-Market', 'Enterprise'], n_samples, p=[0.5, 0.3, 0.2]),

        # CRM features
        'days_in_pipeline': np.random.exponential(45, n_samples).astype(int),
        'touchpoint_count': np.random.poisson(8, n_samples),
        'estimated_deal_value': np.random.lognormal(11, 1.5, n_samples).astype(int),
    })

    # Clip sentiment scores
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

    # Generate target
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

    close_prob = 1 / (1 + np.exp(-close_score * 3 + np.log(1/close_rate - 1)))
    data['deal_closed'] = (np.random.random(n_samples) < close_prob).astype(int)

    # Generate deal value
    value_multiplier = (
        1.0 +
        0.3 * data['product_sentiment'].clip(0, 1) +
        0.2 * data['customer_engagement_score'] -
        0.15 * np.abs(data['pricing_sentiment'])
    )

    data['deal_value'] = np.where(
        data['deal_closed'] == 1,
        data['estimated_deal_value'] * value_multiplier * np.random.lognormal(0, 0.3, n_samples),
        0
    ).astype(int)

    return data


def prepare_features(df: pd.DataFrame) -> tuple:
    """Prepare features and targets."""
    feature_cols = [
        # Sentiment features
        'overall_sentiment_score', 'product_sentiment', 'pricing_sentiment', 'competitors_sentiment',
        # Engagement scores
        'customer_engagement_score', 'urgency_score', 'budget_confidence_score',
        # Binary signals
        'next_steps_defined', 'timeline_mentioned', 'decision_maker_identified', 'competitors_mentioned',
        # Text statistics (NEW - high impact)
        'transcript_word_count', 'customer_word_count', 'customer_question_count',
        'technical_term_count', 'pricing_mention_count', 'competitor_mention_count',
        # Categorical
        'call_category', 'industry', 'customer_size', 'sentiment_trajectory',
        # CRM features
        'days_in_pipeline', 'touchpoint_count', 'estimated_deal_value'
    ]

    cat_features = ['call_category', 'industry', 'customer_size', 'sentiment_trajectory']

    X = df[feature_cols].copy()
    y_close = df['deal_closed']
    y_value = df['deal_value']

    return X, y_close, y_value, cat_features


def train_and_get_metrics(data: pd.DataFrame) -> dict:
    """Train model and return comprehensive metrics."""

    X, y_close, y_value, cat_features = prepare_features(data)

    # Split data
    X_train, X_test, y_close_train, y_close_test, y_value_train, y_value_test = train_test_split(
        X, y_close, y_value,
        test_size=0.2,
        random_state=42,
        stratify=y_close
    )

    # Train model
    model = TwoStageDealModel(
        cat_features=cat_features,
        classifier_params={'verbose': False},
        regressor_params={'verbose': False}
    )

    model.fit(X_train, y_close_train, y_value_train)

    # Get predictions
    expected_value, p_close, value_if_closed = model.predict(X_test, return_components=True)
    y_close_pred = (p_close >= 0.5).astype(int)

    # Evaluate
    metrics = model.evaluate(X_test, y_close_test, y_value_test, beta=2.0)

    # Get feature importance
    clf_importance, reg_importance = model.get_feature_importance()

    # Get ROC curve data
    fpr, tpr, _ = roc_curve(y_close_test, p_close)

    # Get PR curve data
    precision, recall, _ = precision_recall_curve(y_close_test, p_close)

    # Sample predictions for display
    sample_size = min(10, len(X_test))
    sample_predictions = []
    for i in range(sample_size):
        sample_predictions.append({
            'deal_num': i + 1,
            'p_close': float(p_close[i]),
            'value_if_closed': float(value_if_closed[i]),
            'expected_value': float(expected_value[i]),
            'actual_closed': bool(y_close_test.iloc[i]),
            'actual_value': float(y_value_test.iloc[i])
        })

    # Compile response
    response = {
        'success': True,
        'data_stats': {
            'total_samples': int(len(data)),
            'train_samples': int(len(X_train)),
            'test_samples': int(len(X_test)),
            'close_rate_actual': float(y_close_test.mean()),
            'total_actual_value': float(y_value_test.sum()),
            'avg_deal_value': float(y_value_test[y_close_test == 1].mean()) if (y_close_test == 1).sum() > 0 else 0
        },
        'classification_metrics': {
            'roc_auc': float(metrics['roc_auc']),
            'pr_auc': float(metrics['pr_auc']),
            'f2_score': float(metrics['f2.0_score']),
            'close_rate_predicted': float(metrics['close_rate_predicted'])
        },
        'regression_metrics': {
            'rmse_closed': float(metrics['rmse_closed_deals']) if not np.isnan(metrics['rmse_closed_deals']) else 0,
            'mae_closed': float(metrics['mae_closed_deals']) if not np.isnan(metrics['mae_closed_deals']) else 0,
            'r2_closed': float(metrics['r2_closed_deals']) if not np.isnan(metrics['r2_closed_deals']) else 0
        },
        'business_metrics': {
            'total_predicted_value': float(metrics['total_predicted_value']),
            'value_error_pct': float(metrics['value_error_pct']) if not np.isnan(metrics['value_error_pct']) else 0,
            'rmse_overall': float(metrics['rmse_overall']),
            'mae_overall': float(metrics['mae_overall'])
        },
        'feature_importance': {
            'classifier': clf_importance.head(10).to_dict('records'),
            'regressor': reg_importance.head(10).to_dict('records')
        },
        'roc_curve': {
            'fpr': fpr.tolist(),
            'tpr': tpr.tolist()
        },
        'pr_curve': {
            'precision': precision.tolist(),
            'recall': recall.tolist()
        },
        'sample_predictions': sample_predictions
    }

    return response


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--csv', type=str, help='Path to CSV with labeled data')
    parser.add_argument('--demo', action='store_true', help='Use synthetic demo data')
    parser.add_argument('--samples', type=int, default=500, help='Number of synthetic samples')

    args = parser.parse_args()

    try:
        if args.demo or not args.csv:
            data = generate_synthetic_training_data(n_samples=args.samples)
        else:
            data = pd.read_csv(args.csv)

        result = train_and_get_metrics(data)

        # Output JSON to stdout
        print(json.dumps(result, indent=2))

    except Exception as e:
        error_response = {
            'success': False,
            'error': str(e)
        }
        print(json.dumps(error_response), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
