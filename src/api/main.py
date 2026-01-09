from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from src.utils.config import load_config


# -------------------------
# Helpers
# -------------------------
def now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_expected_features(pipeline: Any) -> List[str]:
    """
    Extract expected feature names from the fitted preprocessing step.

    We trained with:
      Pipeline(steps=[("preprocess", ColumnTransformer([("num", ..., feature_cols)])),
                     ("model", Ridge(...))])
    """
    preprocess = getattr(pipeline, "named_steps", {}).get("preprocess")
    if preprocess is None:
        raise ValueError("Pipeline does not contain 'preprocess' step.")

    transformers = getattr(preprocess, "transformers_", None)
    if not transformers:
        raise ValueError("Preprocessor seems unfitted (transformers_ missing).")

    # We used ("num", numeric_transformer, feature_cols)
    _, _, cols = transformers[0]
    if isinstance(cols, (list, tuple)):
        return list(cols)

    raise ValueError("Could not extract expected feature columns from the preprocessor.")


def read_json_file(path: Path) -> Dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"JSON file not found: {path.resolve()}")
    return json.loads(path.read_text(encoding="utf-8"))


# -------------------------
# Request Schema (Pydantic)
# -------------------------
class HouseFeatures(BaseModel):
    # English comment: Request schema for California Housing features
    MedInc: float
    HouseAge: float
    AveRooms: float
    AveBedrms: float
    Population: float
    AveOccup: float
    Latitude: float
    Longitude: float


# -------------------------
# App State (loaded at startup)
# -------------------------
STATE: Dict[str, Any] = {
    "cfg": None,
    "pipeline": None,
    "expected_features": None,
    "model_path": None,
    "metrics_path": None,
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Load model + expected features once at startup.
    This avoids re-loading model on every request and plays nicely with uvicorn --reload.
    """
    cfg = load_config()
    artifacts_dir = Path(cfg["paths"]["artifacts_dir"])
    model_path = artifacts_dir / cfg["artifacts"]["model_filename"]
    metrics_path = artifacts_dir / cfg["artifacts"]["metrics_filename"]

    if not model_path.exists():
        # Fail fast with a clear error
        raise RuntimeError(
            f"Model not found at: {model_path.resolve()} | "
            "Run training first: python -m src.train.train_baseline"
        )

    pipeline = joblib.load(model_path)
    expected_features = get_expected_features(pipeline)

    STATE["cfg"] = cfg
    STATE["pipeline"] = pipeline
    STATE["expected_features"] = expected_features
    STATE["model_path"] = model_path
    STATE["metrics_path"] = metrics_path

    yield

    # Optional cleanup (not required for joblib objects)
    STATE["pipeline"] = None
    STATE["expected_features"] = None


app = FastAPI(
    title="House Price Prediction API",
    version="0.2.0",
    lifespan=lifespan,
)


# -------------------------
# CORS
# -------------------------
# English comment: You can override with env var ALLOWED_ORIGINS (comma-separated)
default_origins = ["http://localhost:5173", "http://localhost:3000"]
env_origins = os.getenv("ALLOWED_ORIGINS", "").strip()
allow_origins = [o.strip() for o in env_origins.split(",") if o.strip()] if env_origins else default_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -------------------------
# Routes
# -------------------------
@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "name": "House Price Prediction API",
        "version": app.version,
        "docs": "/docs",
        "time_utc": now_utc_iso(),
    }


@app.get("/health")
def health() -> Dict[str, Any]:
    pipeline_loaded = STATE.get("pipeline") is not None
    expected = STATE.get("expected_features") or []
    metrics_path: Optional[Path] = STATE.get("metrics_path")

    return {
        "status": "ok",
        "pipeline_loaded": pipeline_loaded,
        "expected_features_count": len(expected),
        "metrics_available": bool(metrics_path and metrics_path.exists()),
        "time_utc": now_utc_iso(),
    }


@app.get("/schema")
def schema() -> Dict[str, Any]:
    expected = STATE.get("expected_features")
    if not expected:
        raise HTTPException(status_code=503, detail="Model not loaded yet.")
    return {
        "expected_features": expected,
        "time_utc": now_utc_iso(),
    }


@app.get("/metrics")
def metrics() -> Dict[str, Any]:
    metrics_path: Optional[Path] = STATE.get("metrics_path")
    if not metrics_path or not metrics_path.exists():
        raise HTTPException(status_code=404, detail="metrics.json not found. Train the model first.")

    try:
        data = read_json_file(metrics_path)
        data["time_utc"] = now_utc_iso()
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail="Could not read metrics.json") from e


@app.post("/predict")
def predict(payload: HouseFeatures) -> Dict[str, Any]:
    pipeline = STATE.get("pipeline")
    expected = STATE.get("expected_features")

    if pipeline is None or not expected:
        raise HTTPException(status_code=503, detail="Model not loaded yet.")

    # English comment: Support both Pydantic v1 and v2 in a safe way
    try:
        data = payload.model_dump()
    except AttributeError:
        data = payload.dict()

    # Build dataframe in expected column order
    try:
        X = pd.DataFrame([data], columns=expected)
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid input payload for model schema.") from e

    # Ensure numeric (extra safety)
    for c in expected:
        if pd.isna(X.loc[0, c]):
            raise HTTPException(status_code=400, detail=f"Missing value for feature: {c}")

    try:
        pred = float(pipeline.predict(X)[0])
        return {
            "prediction": pred,
            "time_utc": now_utc_iso(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal prediction error") from e
