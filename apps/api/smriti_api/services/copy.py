"""Server-side copy (push bodies, emails) read from the ``packages/i18n`` catalogues (AGENTS rule 7).

The server never carries its own strings: it reads the same flat EN and HI catalogues the apps
use (``packages/i18n/src/locales/{locale}/{namespace}.json``) and fills ``{placeholders}``.
``I18N_LOCALES_DIR`` points at another copy of the catalogues (for example in a slim image).
"""

from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Literal

from smriti_api.core.config import REPO_ROOT

Locale = Literal["en", "hi"]
_PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")


def locales_dir() -> Path:
    override = os.environ.get("I18N_LOCALES_DIR")
    return Path(override) if override else REPO_ROOT / "packages" / "i18n" / "src" / "locales"


@lru_cache(maxsize=32)
def _catalogue(locale: str, namespace: str) -> dict[str, str]:
    path = locales_dir() / locale / f"{namespace}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    return {k: v for k, v in data.items() if isinstance(v, str)}


class MissingCopy(KeyError):
    pass


def text(namespace: str, key: str, locale: str = "en", **values: object) -> str:
    """The string for ``key`` in ``locale`` (falling back to English), with values filled in.

    A placeholder without a value is an error: a half-filled push is worse than none.
    """
    loc = locale if locale in ("en", "hi") else "en"
    raw = _catalogue(loc, namespace).get(key)
    if raw is None and loc != "en":
        raw = _catalogue("en", namespace).get(key)
    if raw is None:
        raise MissingCopy(f"{namespace}:{key}")

    def fill(m: re.Match[str]) -> str:
        name = m.group(1)
        if name not in values or values[name] is None:
            raise MissingCopy(f"{namespace}:{key} needs {{{name}}}")
        return str(values[name])

    return _PLACEHOLDER.sub(fill, raw)


def has(namespace: str, key: str, locale: str = "en") -> bool:
    return key in _catalogue(locale if locale in ("en", "hi") else "en", namespace)
