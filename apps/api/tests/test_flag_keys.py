"""Every flag the seed serves through ``/v1/config`` uses a key that ``packages/config`` knows
(its name or an alias), so the client never silently falls back to its default."""

from __future__ import annotations

import re

from sqlalchemy import text

from smriti_api.core.config import REPO_ROOT
from smriti_api.core.deps import AppServices

# Read only by the server; the client has no use for them.
SERVER_ONLY = {
    "xp.rules",  # XP amounts: the server is the only one that awards XP
    "pricing.display",  # becomes /v1/config "pricing"
    "streak.incident_freeze_windows",  # outage dates for the recompute (R28)
}


def client_flag_keys() -> set[str]:
    source = (REPO_ROOT / "packages" / "config" / "src" / "flags.ts").read_text()
    keys = set(re.findall(r"^  '([a-z0-9_.]+)': (?:def|owner)\(", source, flags=re.MULTILINE))
    # Aliases are the last argument: a list of older names.
    keys |= set(re.findall(r"\[\s*'([a-z0-9_.]+)'\s*\]\s*,?\s*\)", source))
    assert len(keys) > 100, "could not read packages/config/src/flags.ts"
    return keys


async def test_seeded_flags_are_known_to_the_client(services: AppServices) -> None:
    async with services.db.admin_tx() as session:
        seeded = set((await session.execute(text("select key from ops.flags"))).scalars())
    unknown = sorted(seeded - client_flag_keys() - SERVER_ONLY)
    assert unknown == [], f"flags packages/config does not define: {unknown}"
