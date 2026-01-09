from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Tuple

import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from src.utils.config import load_config


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def load_processed_data(cfg: Dict[str, Any]) -> Tuple[pd.DataFrame, pd.DataFrame]:
    processed_dir = Path(cfg["paths"]["processed_dir"])
    train_path = processed_dir / cfg["processed"]["train_filename"]
    test_path = processed_dir / cfg["processed"]["test_filename"]

    if not train_path.exists() or not test_path.exists():
        raise FileNotFoundError(
            f"Processed data not found. Expected:\n- {train_path.resolve()}\n- {test_path.resolve()}\n"
            "Run: python -m src.data.validate_split"
        )

    train_df = pd.read_csv(train_path)
    test_df = pd.read_csv(test_path)
    return train_df, test_df


def build_pipeline(feature_cols: list[str], alpha: float) -> Pipeline:
    # English comment: California housing is numeric-only, but we still build a proper preprocessing pipeline.
    numeric_transformer = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ]
    )

    preprocessor = ColumnTransformer(
        transformers=[
            ("num", numeric_transformer, feature_cols),
        ],
        remainder="drop",
    )

    model = Ridge(alpha=alpha, random_state=42)

    pipeline = Pipeline(
        steps=[
            ("preprocess", preprocessor),
            ("model", model),
        ]
    )
    return pipeline


def main() -> None:
    cfg = load_config()

    target_col = cfg["data"]["target_column"]
    artifacts_dir = Path(cfg["paths"]["artifacts_dir"])
    ensure_dir(artifacts_dir)

    train_df, test_df = load_processed_data(cfg)

    if target_col not in train_df.columns:
        raise ValueError(f"Target column '{target_col}' not found in train.csv")

    feature_cols = [c for c in train_df.columns if c != target_col]

    X_train = train_df[feature_cols]
    y_train = train_df[target_col]

    X_test = test_df[feature_cols]
    y_test = test_df[target_col]

    alpha = float(cfg["training"].get("ridge_alpha", 1.0))
    pipeline = build_pipeline(feature_cols=feature_cols, alpha=alpha)

    pipeline.fit(X_train, y_train)

    preds = pipeline.predict(X_test)

    mse = mean_squared_error(y_test, preds)
    rmse = mse ** 0.5
    mae = mean_absolute_error(y_test, preds)

    metrics: Dict[str, Any] = {
        "model_type": cfg["training"].get("model_type", "ridge"),
        "ridge_alpha": alpha,
        "rmse": float(rmse),
        "mae": float(mae),
        "n_train": int(len(train_df)),
        "n_test": int(len(test_df)),
        "feature_count": int(len(feature_cols)),
        "target_column": target_col,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
    }

    model_filename = cfg["artifacts"]["model_filename"]
    metrics_filename = cfg["artifacts"]["metrics_filename"]

    model_path = artifacts_dir / model_filename
    metrics_path = artifacts_dir / metrics_filename

    joblib.dump(pipeline, model_path)
    metrics_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    print(f"[OK] Saved model pipeline: {model_path}")
    print(f"[OK] Saved metrics: {metrics_path}")
    print(f"[METRICS] RMSE={rmse:.4f} | MAE={mae:.4f}")


if __name__ == "__main__":
    main()
