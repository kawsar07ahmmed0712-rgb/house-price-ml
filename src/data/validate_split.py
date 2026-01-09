from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any

import pandas as pd
from sklearn.model_selection import train_test_split

from src.utils.config import load_config


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def basic_validation(df: pd.DataFrame, target_col: str) -> Dict[str, Any]:
    # Basic checks that are cheap and useful
    report: Dict[str, Any] = {}

    report["rows"] = int(df.shape[0])
    report["cols"] = int(df.shape[1])
    report["columns"] = list(df.columns)

    report["missing_by_column"] = df.isna().sum().astype(int).to_dict()
    report["total_missing"] = int(df.isna().sum().sum())

    report["duplicate_rows"] = int(df.duplicated().sum())

    report["target_column"] = target_col
    report["target_missing"] = int(df[target_col].isna().sum()) if target_col in df.columns else None

    # Simple numeric sanity checks (California housing is numeric)
    numeric_cols = df.select_dtypes(include="number").columns.tolist()
    report["numeric_columns"] = numeric_cols

    if target_col not in df.columns:
        report["errors"] = [f"Target column '{target_col}' not found in data."]
        return report

    if len(numeric_cols) != df.shape[1]:
        non_numeric = [c for c in df.columns if c not in numeric_cols]
        report["warnings"] = [f"Non-numeric columns found: {non_numeric}"]

    # Range summary (min/max) for quick anomaly spotting
    minmax = {}
    for c in numeric_cols:
        minmax[c] = {"min": float(df[c].min()), "max": float(df[c].max())}
    report["min_max"] = minmax

    report["errors"] = []
    report.setdefault("warnings", [])

    # Guard rails
    if report["rows"] == 0:
        report["errors"].append("Dataset has 0 rows.")
    if report["cols"] == 0:
        report["errors"].append("Dataset has 0 columns.")
    if report["total_missing"] > 0:
        report["warnings"].append("Missing values detected (will handle in preprocessing later).")
    if report["duplicate_rows"] > 0:
        report["warnings"].append("Duplicate rows detected (consider dropping later).")

    return report


def main() -> None:
    cfg = load_config()

    raw_dir = Path(cfg["paths"]["raw_dir"])
    processed_dir = Path(cfg["paths"]["processed_dir"])
    artifacts_dir = Path(cfg["paths"]["artifacts_dir"])

    raw_path = raw_dir / cfg["data"]["raw_filename"]
    target_col = cfg["data"]["target_column"]

    ensure_dir(processed_dir)
    ensure_dir(artifacts_dir)

    if not raw_path.exists():
        raise FileNotFoundError(f"Raw data not found: {raw_path.resolve()} (Run ingestion first)")

    df = pd.read_csv(raw_path)

    # Validation report
    report = basic_validation(df, target_col)
    report["generated_at_utc"] = datetime.now(timezone.utc).isoformat()
    report_path = artifacts_dir / "validation_report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    if report.get("errors"):
        print(f"[ERROR] Validation failed. See: {report_path}")
        for e in report["errors"]:
            print(f" - {e}")
        raise SystemExit(1)

    # Reproducible split
    test_size = float(cfg["training"]["test_size"])
    random_state = int(cfg["training"]["random_state"])

    train_df, test_df = train_test_split(
        df,
        test_size=test_size,
        random_state=random_state,
        shuffle=True,
    )

    train_path = processed_dir / cfg["processed"]["train_filename"]
    test_path = processed_dir / cfg["processed"]["test_filename"]

    train_df.to_csv(train_path, index=False)
    test_df.to_csv(test_path, index=False)

    print(f"[OK] Validation report: {report_path}")
    print(f"[OK] Saved train: {train_path} | shape={train_df.shape}")
    print(f"[OK] Saved test : {test_path} | shape={test_df.shape}")


if __name__ == "__main__":
    main()
