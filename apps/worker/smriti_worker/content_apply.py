"""``python -m smriti_worker.content_apply --report DIR [--root content]``

The database half of a content publish, for the deploy workflow (.github/workflows/deploy-content.yml).
The workflow runs ``tools/content-publish --target r2``, which uploads bundles, media, patches and
manifests to R2 and writes ``metadata.sql`` to the report folder. This then does what the worker's
``content_publish`` job does after the tool: it applies ``metadata.sql`` (content.* rows) in one
transaction and rebuilds ``content.card_index`` from the lesson files.

The worker image carries no Node toolchain, so in deployed environments the publish runs in CI and
the ``content-publish`` queue's job reports "skipped". ``DATABASE_URL`` picks the database, as for
the API. Only counts are printed.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from smriti_api.core.config import REPO_ROOT, get_settings
from smriti_api.core.db import Database
from smriti_api.services import card_index

from smriti_worker.jobs import apply_metadata_sql


async def apply(report: Path, root: Path, db: Database | None = None) -> dict[str, Any]:
    metadata = report / "metadata.sql"
    if not metadata.is_file():
        raise FileNotFoundError(f"no metadata.sql in {report}")
    if not any((root / "lessons").rglob("*.json")):
        # The card index retires every card it does not see, so never run it on an empty root.
        raise FileNotFoundError(f"no lessons under {root}")
    settings = get_settings()
    own = db is None
    db = db or Database(settings.database_url, pool_size=2, system_role=settings.db_system_role)
    try:
        size = await apply_metadata_sql(db, metadata)
        async with db.system_tx() as session:
            counts = await card_index.index_lessons(session, root)
    finally:
        if own:
            await db.engine.dispose()
    return {"metadata_bytes": size, "card_index": counts}


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m smriti_worker.content_apply")
    parser.add_argument("--report", type=Path, required=True, help="the publish report folder")
    parser.add_argument("--root", type=Path, default=REPO_ROOT / "content")
    args = parser.parse_args(argv)
    try:
        result = asyncio.run(apply(args.report.resolve(), args.root.resolve()))
    except FileNotFoundError as exc:
        print(f"content_apply: {exc}", file=sys.stderr)
        return 1
    print(f"content_apply: {result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
