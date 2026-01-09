from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

import joblib
import pandas as pd

from src.utils.config import load_config


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def get_expected_features(pipeline: Any) -> List[str]:
    """
    Extract expected feature names from the fitted preprocessing step.
    This relies on how we built the ColumnTransformer in training.
    """
    preprocess = pipeline.named_steps.get("preprocess")
    if preprocess is None:
        raise ValueError("Pipeline does not contain 'preprocess' step.")

    # After fit, ColumnTransformer has transformers_ populated.
    transformers = getattr(preprocess, "transformers_", None)
    if not transformers:
        raise ValueError("Preprocessor seems unfitted (transformers_ missing). Train first.")

    # We used ("num", numeric_transformer, feature_cols)
    # So index 0 should be the numeric transformer tuple.
    _, _, cols = transformers[0]
    if isinstance(cols, (list, tuple)):
        return list(cols)

    # Fallback: if it is a slice or something unusual
    raise ValueError("Could not extract expected feature columns from the preprocessor.")


def validate_and_build_input(payload: Dict[str, Any], expected_features: List[str]) -> pd.DataFrame:
    """
    Validate input JSON keys and create a single-row DataFrame in correct column order.
    """
    missing = [c for c in expected_features if c not in payload]
    if missing:
        raise ValueError(f"Missing required features: {missing}")

    # Keep only expected keys (ignore extras)
    row = {c: payload[c] for c in expected_features}
    return pd.DataFrame([row], columns=expected_features)


def make_sample_payload() -> Dict[str, float]:
    # English comment: Typical-ish values for California Housing numeric features.
    return {
        "MedInc": 5.0,
        "HouseAge": 20.0,
        "AveRooms": 5.0,
        "AveBedrms": 1.0,
        "Population": 1000.0,
        "AveOccup": 3.0,
        "Latitude": 34.05,
        "Longitude": -118.25,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="House price prediction (local).")
    parser.add_argument("--sample", action="store_true", help="Generate a sample request and predict.")
    parser.add_argument("--file", type=str, default="", help="Path to a JSON file containing input features.")
    args = parser.parse_args()

    cfg = load_config()

    artifacts_dir = Path(cfg["paths"]["artifacts_dir"])
    ensure_dir(artifacts_dir)

    model_path = artifacts_dir / cfg["artifacts"]["model_filename"]
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path.resolve()} (Run training first)")

    pipeline = joblib.load(model_path)
    expected_features = get_expected_features(pipeline)

    if args.sample:
        payload = make_sample_payload()

        # Save sample request artifact
        req_path = artifacts_dir / cfg["artifacts"]["sample_request_filename"]
        req_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    elif args.file:
        file_path = Path(args.file)
        if not file_path.exists():
            raise FileNotFoundError(f"Input JSON file not found: {file_path.resolve()}")
        payload = json.loads(file_path.read_text(encoding="utf-8"))

    else:
        raise SystemExit("Provide --sample or --file <path-to-json>")

    X = validate_and_build_input(payload, expected_features)
    pred = float(pipeline.predict(X)[0])

    response = {
        "prediction": pred,
        "expected_features": expected_features,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
    }

    if args.sample:
        # Save sample response artifact
        resp_path = artifacts_dir / cfg["artifacts"]["sample_response_filename"]
        resp_path.write_text(json.dumps(response, indent=2), encoding="utf-8")
        print(f"[OK] Saved sample request:  {req_path}")
        print(f"[OK] Saved sample response: {resp_path}")

    print(f"[PREDICTION] {pred}")


if __name__ == "__main__":
    main()
