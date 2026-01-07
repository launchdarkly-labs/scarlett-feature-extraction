#!/usr/bin/env python3
"""
Train model and return metrics as JSON (for API consumption)

Usage:
    python ml/train_and_return_metrics.py --csv extracted_features.csv
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


def prepare_features(df: pd.DataFrame) -> tuple:
    """Prepare features and targets."""

    # Check if we have the exact extraction format columns
    # and handle both formats for backward compatibility
    sentiment_cols_extraction = ['sentiment_about_product', 'sentiment_about_pricing', 'sentiment_about_competitors']
    sentiment_cols_ml = ['product_sentiment', 'pricing_sentiment', 'competitors_sentiment']

    # Use extraction format if available, otherwise fall back to ML format
    has_extraction_format = all(col in df.columns for col in sentiment_cols_extraction)

    if has_extraction_format:
        feature_cols = [
            # Sentiment features - extraction format
            'overall_sentiment_score', 'sentiment_about_product', 'sentiment_about_pricing',
            'sentiment_about_competitors', 'sentiment_about_current_solution', 'sentiment_about_market_conditions',
            # Engagement scores
            'customer_engagement_score', 'urgency_score', 'budget_confidence_score',
            # Binary signals
            'next_steps_defined', 'timeline_mentioned', 'decision_maker_identified', 'competitors_mentioned',
            # Text statistics
            'transcript_word_count', 'customer_word_count', 'customer_question_count',
            'technical_term_count', 'pricing_mention_count', 'competitor_mention_count',
            # Categorical
            'call_category', 'industry', 'customer_size',
            # CRM features
            'days_in_pipeline', 'touchpoint_count', 'estimated_deal_value'
        ]
    else:
        # Fall back to old format for backward compatibility
        feature_cols = [
            # Sentiment features - ML format
            'overall_sentiment_score', 'product_sentiment', 'pricing_sentiment', 'competitors_sentiment',
            # Engagement scores
            'customer_engagement_score', 'urgency_score', 'budget_confidence_score',
            # Binary signals
            'next_steps_defined', 'timeline_mentioned', 'decision_maker_identified', 'competitors_mentioned',
            # Text statistics
            'transcript_word_count', 'customer_word_count', 'customer_question_count',
            'technical_term_count', 'pricing_mention_count', 'competitor_mention_count',
            # Categorical
            'call_category', 'industry', 'customer_size',
            # CRM features
            'days_in_pipeline', 'touchpoint_count', 'estimated_deal_value'
        ]

    # Add sentiment_trajectory if it exists (optional field)
    if 'sentiment_trajectory' in df.columns:
        feature_cols.append('sentiment_trajectory')
        cat_features = ['call_category', 'industry', 'customer_size', 'sentiment_trajectory']
    else:
        cat_features = ['call_category', 'industry', 'customer_size']

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

    # Find optimal threshold for F2 score (emphasizes recall)
    from sklearn.metrics import fbeta_score, confusion_matrix
    thresholds = np.arange(0.1, 0.7, 0.05)
    f2_scores = []

    for thresh in thresholds:
        pred = (p_close >= thresh).astype(int)
        f2 = fbeta_score(y_close_test, pred, beta=2.0)
        f2_scores.append(f2)

    # Use the threshold that maximizes F2 score
    optimal_threshold = thresholds[np.argmax(f2_scores)]
    y_close_pred = (p_close >= optimal_threshold).astype(int)

    # Get confusion matrix for optimal threshold
    tn, fp, fn, tp = confusion_matrix(y_close_test, y_close_pred).ravel()

    # Calculate additional metrics
    precision_score = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall_score = tp / (tp + fn) if (tp + fn) > 0 else 0
    specificity = tn / (tn + fp) if (tn + fp) > 0 else 0

    # Evaluate
    metrics = model.evaluate(X_test, y_close_test, y_value_test, beta=2.0)

    # Get feature importance
    clf_importance, reg_importance = model.get_feature_importance()

    # Get ROC curve data
    fpr, tpr, _ = roc_curve(y_close_test, p_close)

    # Get PR curve data
    pr_precision, pr_recall, _ = precision_recall_curve(y_close_test, p_close)

    # Sample predictions for display (using optimal threshold)
    sample_size = min(10, len(X_test))
    sample_predictions = []
    for i in range(sample_size):
        sample_predictions.append({
            'deal_num': i + 1,
            'p_close': float(p_close[i]),
            'value_if_closed': float(value_if_closed[i]),
            'expected_value': float(expected_value[i]),
            'actual_closed': bool(y_close_test.iloc[i]),
            'actual_value': float(y_value_test.iloc[i]),
            'predicted_closed': bool(y_close_pred[i])  # Using optimal threshold
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
            'f2_score': float(max(f2_scores)),  # Best F2 score with optimal threshold
            'close_rate_predicted': float(y_close_pred.mean()),  # Using optimal threshold
            'optimal_threshold': float(optimal_threshold),
            'precision': float(precision_score),
            'recall': float(recall_score),
            'specificity': float(specificity),
            'confusion_matrix': {
                'true_negatives': int(tn),
                'false_positives': int(fp),
                'false_negatives': int(fn),
                'true_positives': int(tp)
            }
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
            'precision': pr_precision.tolist(),
            'recall': pr_recall.tolist()
        },
        'sample_predictions': sample_predictions
    }

    return response


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--csv', type=str, required=True, help='Path to CSV with labeled data')

    args = parser.parse_args()

    try:
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
