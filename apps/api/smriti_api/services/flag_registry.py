"""The flag registry's defaults, shared with the apps (``packages/config/src/flags.ts``).

``packages/config`` generates ``flag-defaults.json`` from its registry (``pnpm --filter
@smriti/config flags:export``; a config test fails when the file is stale). The API reads that
file here, so a default lives in one place for the server and the apps. Owner flags have a ``null``
default: the feature or limit is off until the owner sets it (practice §9.2). ``FLAG_DEFAULTS_PATH``
points at another copy of the file (for example in a slim image).
"""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path
from typing import Any

from smriti_api.core.config import REPO_ROOT


def defaults_path() -> Path:
    override = os.environ.get("FLAG_DEFAULTS_PATH")
    if override:
        return Path(override)
    return REPO_ROOT / "packages" / "config" / "flag-defaults.json"


@lru_cache(maxsize=1)
def _document() -> tuple[dict[str, Any], dict[str, str]]:
    data = json.loads(defaults_path().read_text(encoding="utf-8"))
    flags = {k: v.get("default") for k, v in data["flags"].items()}
    return flags, dict(data.get("aliases", {}))


def default(key: str) -> Any:
    """The registry default for ``key`` (``None`` for owner flags and unknown keys)."""
    return _document()[0].get(key)


def known(key: str) -> bool:
    return key in _document()[0]


def canonical(values: Mapping[str, Any]) -> dict[str, Any]:
    """Server values with older doc spellings mapped to their key; the key itself wins."""
    flags, aliases = _document()
    out: dict[str, Any] = {}
    for key, value in values.items():
        if key in flags or key not in aliases:
            out[key] = value
    for alias, key in aliases.items():
        if alias in values and key not in out:
            out[key] = values[alias]
    return out
