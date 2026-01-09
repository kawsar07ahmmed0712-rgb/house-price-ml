from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from sklearn.datasets import fetch_california_housing

from src.utils.config import load_config


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def main() -> None:
    cfg = load_config()

    raw_dir = Path(cfg["paths"]["raw_dir"])
    artifacts_dir = Path(cfg["paths"]["artifacts_dir"])
    raw_filename = cfg["data"]["raw_filename"]

    ensure_dir(raw_dir)
    ensure_dir(artifacts_dir)

    bunch = fetch_california_housing(as_frame=True)

    # Build a single dataframe with features + target
    if getattr(bunch, "frame", None) is not None:
        df = bunch.frame.copy()
    else:
        df = pd.concat([bunch.data, bunch.target], axis=1)

    # Ensure target column has a consistent name
    target_name = getattr(bunch, "target_names", None)
    if isinstance(target_name, list) and len(target_name) == 1:
        target_col = target_name[0]
    else:
        # fallback for sklearn variations
        target_col = "MedHouseVal"

    if target_col not in df.columns and "target" in df.columns:
        df = df.rename(columns={"target": target_col})

    raw_path = raw_dir / raw_filename
    df.to_csv(raw_path, index=False)

    run_info = {
        "dataset": "california_housing",
        "saved_raw_path": str(raw_path.as_posix()),
        "rows": int(df.shape[0]),
        "cols": int(df.shape[1]),
        "feature_columns": [c for c in df.columns if c != target_col],
        "target_column": target_col,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
    }

    (artifacts_dir / "run_info.json").write_text(
        json.dumps(run_info, indent=2),
        encoding="utf-8",
    )

    print(f"[OK] Saved raw dataset: {raw_path}")
    print(f"[OK] Saved run metadata: {artifacts_dir / 'run_info.json'}")
    print(f"[INFO] Shape: {df.shape} | Target: {target_col}")


if __name__ == "__main__":
    main()
