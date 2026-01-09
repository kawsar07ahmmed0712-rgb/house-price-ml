from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

import yaml


def load_config(config_path: str = "configs/config.yaml") -> Dict[str, Any]:
    """
    Loads YAML config from the given path.
    """
    path = Path(config_path)
    if not path.exists():
        raise FileNotFoundError(f"Config file not found: {path.resolve()}")

    with path.open("r", encoding="utf-8") as f:
        cfg = yaml.safe_load(f)

    if not isinstance(cfg, dict):
        raise ValueError("Config root must be a YAML mapping (dictionary).")

    return cfg
