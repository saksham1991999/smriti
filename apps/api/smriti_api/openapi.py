"""Print the OpenAPI document: ``uv run python -m smriti_api.openapi > packages/api-client/openapi.json``.

The dev auth routes are included (they exist in local and test, where the clients use them),
and marked with ``x-dev-only``.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from smriti_api.core.config import AppEnv, Settings


def build_openapi() -> dict[str, Any]:
    from smriti_api.main import create_app

    app = create_app(Settings(app_env=AppEnv.local, log_level="WARNING"))
    doc = app.openapi()
    for path, item in doc.get("paths", {}).items():
        if path.startswith("/v1/dev/"):
            for op in item.values():
                if isinstance(op, dict):
                    op["x-dev-only"] = True
    return doc


def main() -> None:
    sys.stdout.write(json.dumps(build_openapi(), indent=2, sort_keys=False) + "\n")


if __name__ == "__main__":
    main()
