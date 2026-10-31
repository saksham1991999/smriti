"""The consent gate social features call (AGENTS rule 8, DPDP s.9, auth flow §6.10).

A thin layer over :mod:`smriti_api.services.privacy`, which owns the rules: adults (age band
``18p``) pass; minors, and accounts whose age is not known yet (the safe side), need an active
guardian consent that grants both ``account`` and ``social``. Leagues, duos, friends and any
other social surface gate on these functions instead of reading ``app.guardian_consents``.

- :func:`has_social_consent` answers yes or no inside the caller's transaction.
- :func:`require_social_consent` raises 403 ``guardian_consent_required`` (``scope: social``),
  the error the apps already turn into the "Ask a grown-up" sheet.
- :func:`social_allowed` opens its own short transaction, for jobs and fan-out code that hold
  no session.
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.services import privacy

SOCIAL_SCOPE = "social"


async def require_social_consent(session: AsyncSession, user_id: uuid.UUID) -> None:
    await privacy.require_scope(session, user_id, SOCIAL_SCOPE)


async def has_social_consent(session: AsyncSession, user_id: uuid.UUID) -> bool:
    try:
        await require_social_consent(session, user_id)
    except ApiError:
        return False
    return True


async def social_allowed(db: Database, user_id: uuid.UUID) -> bool:
    return await privacy.scope_allowed(db, user_id, SOCIAL_SCOPE)
