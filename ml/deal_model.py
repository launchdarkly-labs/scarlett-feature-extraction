"""
Two-Stage CatBoost Model for Sales Deal Prediction

This model predicts deal outcomes using a two-stage approach ideal for sales data:
- Stage 1 (Classifier): Predicts P(deal closes) - binary outcome
- Stage 2 (Regressor): Predicts E[deal_value | closed] - value given closure
- Final prediction: P(close) × E[value | closed]

This approach is ideal because:
- Most deals don't close (90-95% zero rate in typical B2B sales)
- Closed deals have varying values
- Single regressor struggles with this zero-inflated distribution
"""

import numpy as np
import pandas as pd
from catboost import CatBoostClassifier, CatBoostRegressor, Pool
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    roc_auc_score,
    precision_recall_curve,
    average_precision_score,
    fbeta_score,
    classification_report,
    mean_squared_error,
    mean_absolute_error,
    r2_score
)
from typing import Tuple, Optional, List


class TwoStageDealModel:
    """
    Production-ready two-stage model for deal close prediction and value estimation.

    Usage:
        model = TwoStageDealModel(cat_features=['industry', 'region'])
        model.fit(X_train, y_close_train, y_value_train)
        predictions = model.predict(X_test, return_components=True)
    """

    def __init__(
        self,
        cat_features: Optional[List[str]] = None,
        classifier_params: Optional[dict] = None,
        regressor_params: Optional[dict] = None
    ):
        """
        Initialize the two-stage model.

        Parameters:
        -----------
        cat_features : list of str, optional
            Names of categorical features
        classifier_params : dict, optional
            CatBoost classifier parameters
        regressor_params : dict, optional
            CatBoost regressor parameters
        """
        self.cat_features = cat_features or []

        # Default parameters optimized for sales data
        default_clf_params = {
            'iterations': 500,
            'learning_rate': 0.05,
            'depth': 6,
            'l2_leaf_reg': 3,
            'auto_class_weights': 'Balanced',  # Handle class imbalance
            'eval_metric': 'AUC',
            'early_stopping_rounds': 50,
            'random_seed': 42,
            'verbose': False
        }

        default_reg_params = {
            'iterations': 500,
            'learning_rate': 0.05,
            'depth': 6,
            'l2_leaf_reg': 3,
            'loss_function': 'RMSE',
            'early_stopping_rounds': 50,
            'random_seed': 42,
            'verbose': False
        }

        self.classifier_params = {**default_clf_params, **(classifier_params or {})}
        self.regressor_params = {**default_reg_params, **(regressor_params or {})}

        self.classifier = CatBoostClassifier(**self.classifier_params)
        self.regressor = CatBoostRegressor(**self.regressor_params)
        self._fitted = False

    def fit(
        self,
        X: pd.DataFrame,
        y_close: pd.Series,
        y_value: pd.Series,
        eval_set: Optional[Tuple] = None
    ) -> 'TwoStageDealModel':
        """
        Fit the two-stage model.

        Parameters:
        -----------
        X : DataFrame
            Feature matrix
        y_close : Series
            Binary target (1 = deal closed, 0 = deal lost/open)
        y_value : Series
            Deal values (0 for non-closed deals)
        eval_set : tuple, optional
            (X_val, y_close_val, y_value_val) for validation

        Returns:
        --------
        self : TwoStageDealModel
        """
        # Stage 1: Train classifier on all data
        print("Training Stage 1: Deal Close Classifier...")
        if eval_set:
            X_val, y_close_val, y_value_val = eval_set
            train_pool = Pool(X, y_close, cat_features=self.cat_features)
            val_pool = Pool(X_val, y_close_val, cat_features=self.cat_features)
            self.classifier.fit(train_pool, eval_set=val_pool, use_best_model=True)
        else:
            self.classifier.fit(X, y_close, cat_features=self.cat_features)

        # Stage 2: Train regressor on closed deals only
        print("Training Stage 2: Deal Value Regressor (closed deals only)...")
        converters_mask = y_close == 1
        X_closed = X[converters_mask]
        y_value_closed = y_value[converters_mask]

        print(f"  Training on {len(X_closed)} closed deals out of {len(X)} total")

        if len(X_closed) < 10:
            raise ValueError(f"Not enough closed deals to train regressor (found {len(X_closed)}, need at least 10)")

        if eval_set:
            val_converters_mask = y_close_val == 1
            X_val_closed = X_val[val_converters_mask]
            y_value_val_closed = y_value_val[val_converters_mask]

            if len(X_val_closed) > 0:
                train_pool_reg = Pool(X_closed, y_value_closed, cat_features=self.cat_features)
                val_pool_reg = Pool(X_val_closed, y_value_val_closed, cat_features=self.cat_features)
                self.regressor.fit(train_pool_reg, eval_set=val_pool_reg, use_best_model=True)
            else:
                self.regressor.fit(X_closed, y_value_closed, cat_features=self.cat_features)
        else:
            self.regressor.fit(X_closed, y_value_closed, cat_features=self.cat_features)

        self._fitted = True
        return self

    def predict(
        self,
        X: pd.DataFrame,
        return_components: bool = False
    ) -> np.ndarray:
        """
        Predict expected deal value using two-stage approach.

        Parameters:
        -----------
        X : DataFrame
            Feature matrix
        return_components : bool
            If True, return (expected_value, p_close, value_if_closed)

        Returns:
        --------
        predictions : ndarray
            Expected deal values, or tuple if return_components=True
        """
        if not self._fitted:
            raise ValueError("Model not fitted. Call fit() first.")

        # Stage 1: Get probability of deal closing
        p_close = self.classifier.predict_proba(X)[:, 1]

        # Stage 2: Get expected value if deal closes
        value_if_closed = np.maximum(self.regressor.predict(X), 0)

        # Final prediction: Expected value = P(close) × E[value | closed]
        expected_value = p_close * value_if_closed

        if return_components:
            return expected_value, p_close, value_if_closed
        return expected_value

    def predict_close_probability(self, X: pd.DataFrame) -> np.ndarray:
        """Return only the probability of deal closing."""
        if not self._fitted:
            raise ValueError("Model not fitted. Call fit() first.")
        return self.classifier.predict_proba(X)[:, 1]

    def evaluate(
        self,
        X: pd.DataFrame,
        y_close: pd.Series,
        y_value: pd.Series,
        beta: float = 2.0
    ) -> dict:
        """
        Comprehensive evaluation of the two-stage model.

        Parameters:
        -----------
        X : DataFrame
            Feature matrix
        y_close : Series
            Binary target (actual close status)
        y_value : Series
            Actual deal values
        beta : float
            Beta parameter for F-beta score (default 2.0 for F2 score)
            Beta > 1 emphasizes recall over precision

        Returns:
        --------
        metrics : dict
            Dictionary of evaluation metrics
        """
        if not self._fitted:
            raise ValueError("Model not fitted. Call fit() first.")

        # Get predictions
        expected_value, p_close, value_if_closed = self.predict(X, return_components=True)
        y_close_pred = (p_close >= 0.5).astype(int)

        # Classification metrics (Stage 1)
        roc_auc = roc_auc_score(y_close, p_close)
        pr_auc = average_precision_score(y_close, p_close)
        f2_score = fbeta_score(y_close, y_close_pred, beta=beta)

        # Regression metrics (Stage 2 - on closed deals only)
        closed_mask = y_close == 1
        if closed_mask.sum() > 0:
            y_value_closed_actual = y_value[closed_mask]
            value_closed_pred = value_if_closed[closed_mask]

            rmse_closed = np.sqrt(mean_squared_error(y_value_closed_actual, value_closed_pred))
            mae_closed = mean_absolute_error(y_value_closed_actual, value_closed_pred)
            r2_closed = r2_score(y_value_closed_actual, value_closed_pred)
        else:
            rmse_closed = mae_closed = r2_closed = np.nan

        # Overall value prediction metrics
        rmse_overall = np.sqrt(mean_squared_error(y_value, expected_value))
        mae_overall = mean_absolute_error(y_value, expected_value)

        # Business metrics
        total_actual_value = y_value.sum()
        total_predicted_value = expected_value.sum()
        value_error_pct = ((total_predicted_value - total_actual_value) / total_actual_value * 100) if total_actual_value > 0 else np.nan

        metrics = {
            # Classification metrics (Stage 1)
            'roc_auc': roc_auc,
            'pr_auc': pr_auc,
            f'f{beta}_score': f2_score,
            'close_rate_actual': y_close.mean(),
            'close_rate_predicted': y_close_pred.mean(),

            # Regression metrics (Stage 2 - closed deals)
            'rmse_closed_deals': rmse_closed,
            'mae_closed_deals': mae_closed,
            'r2_closed_deals': r2_closed,

            # Overall value prediction
            'rmse_overall': rmse_overall,
            'mae_overall': mae_overall,

            # Business metrics
            'total_actual_value': total_actual_value,
            'total_predicted_value': total_predicted_value,
            'value_error_pct': value_error_pct,
        }

        return metrics

    def get_feature_importance(self) -> Tuple[pd.DataFrame, pd.DataFrame]:
        """
        Get feature importance for both stages.

        Returns:
        --------
        clf_importance : DataFrame
            Classifier feature importance
        reg_importance : DataFrame
            Regressor feature importance
        """
        if not self._fitted:
            raise ValueError("Model not fitted. Call fit() first.")

        clf_importance = pd.DataFrame({
            'feature': self.classifier.feature_names_,
            'importance': self.classifier.feature_importances_
        }).sort_values('importance', ascending=False)

        reg_importance = pd.DataFrame({
            'feature': self.regressor.feature_names_,
            'importance': self.regressor.feature_importances_
        }).sort_values('importance', ascending=False)

        return clf_importance, reg_importance
