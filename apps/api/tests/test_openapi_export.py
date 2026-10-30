"""The committed OpenAPI document (``packages/api-client/openapi.json``) matches the models, so
the TypeScript client can't drift from the API. Regenerate with
``pnpm --filter @smriti/api-client generate``."""

from __future__ import annotations

import json

from smriti_api.core.config import REPO_ROOT
from smriti_api.openapi import build_openapi


def test_api_client_openapi_is_current() -> None:
    committed = json.loads((REPO_ROOT / "packages" / "api-client" / "openapi.json").read_text())
    assert committed == build_openapi(), (
        "packages/api-client/openapi.json is stale: run `pnpm --filter @smriti/api-client generate`"
    )


def test_every_operation_is_under_v1_and_dev_routes_are_marked() -> None:
    doc = build_openapi()
    for path, item in doc["paths"].items():
        assert path.startswith("/v1/"), path
        for op in item.values():
            assert op.get("x-dev-only", False) == path.startswith("/v1/dev/"), path
