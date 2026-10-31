"""Rebuilds ``content.card_index`` from the lesson files, the step the content publish job runs
right after ``metadata.sql`` (apps/worker ``content_publish``). Used by ``scripts/dev/stack.sh``.

    uv run --project apps/api python scripts/dev/card_index.py [content dir]

DATABASE_URL picks the database, as for the API.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from smriti_api.core.config import REPO_ROOT, get_settings
from smriti_api.core.db import Database
from smriti_api.services import card_index


async def main(root: Path) -> int:
    if not any((root / "lessons").rglob("*.json")):
        # The pass retires every card it does not see, so never run it on an empty folder.
        print(f"no lessons under {root}", file=sys.stderr)
        return 1
    settings = get_settings()
    db = Database(settings.database_url, pool_size=2, system_role=settings.db_system_role)
    try:
        async with db.system_tx() as session:
            counts = await card_index.index_lessons(session, root)
    finally:
        await db.engine.dispose()
    print(f"card index: {counts}")
    return 0


if __name__ == "__main__":
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO_ROOT / "content"
    raise SystemExit(asyncio.run(main(folder.resolve())))
