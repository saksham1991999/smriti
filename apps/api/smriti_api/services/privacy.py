"""Consent gates and the server-side analytics policy (AGENTS rule 8, DPDP s.9, auth flow §6.10, R48).

- :func:`granted_scopes` reads the learner's active guardian consent.
- :func:`require_scope` is the gate every social, public or scoped surface calls: adults pass;
  minors (and unknown ages, the safe side) need the scope in an active consent.
- :class:`ConsentAwareAnalytics` wraps the analytics sink so server events honour the same policy
  as ``packages/analytics`` (``policy.ts``): nothing for a minor while
  ``minor.defer_sync_until_consent`` is on and there is no consent, and no behavioural-tracking
  props for minors.
"""

from __future__ import annotations

import uuid
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.services import flags as flag_service
from smriti_api.services.analytics import AnalyticsSink, Props

log = structlog.get_logger(__name__)

MINOR_BANDS = ("u10", "10_12", "13_17")
# Mirrors MINOR_STRIPPED_PROPS in packages/analytics/src/policy.ts.
MINOR_STRIPPED_PROPS = frozenset(
    {
        "campaign_id",
        "campaign",
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_content",
        "utm_term",
        "referrer",
        "install_referrer",
        "attribution",
        "ad_group",
        "creative_id",
        "experiment_id",
        "variant_id",
        "share_target",
    }
)


async def granted_scopes(session: AsyncSession, user_id: uuid.UUID) -> set[str]:
    scope = (
        await session.execute(
            text(
                "select scope from app.guardian_consents where user_id = :u"
                " and revoked_at is null and superseded_by is null"
            ),
            {"u": user_id},
        )
    ).scalar_one_or_none()
    if not isinstance(scope, dict):
        return set()
    return {k for k, v in scope.items() if v is True}


async def require_scope(session: AsyncSession, user_id: uuid.UUID, scope: str) -> None:
    """Raises 403 ``guardian_consent_required`` (with the scope) when a minor lacks the scope."""
    band = (
        await session.execute(
            text("select age_band from app.profiles where user_id = :u"), {"u": user_id}
        )
    ).scalar_one_or_none()
    if band == "18p":
        return
    scopes = await granted_scopes(session, user_id)
    if "account" in scopes and scope in scopes:
        return
    raise ApiError(
        403,
        "guardian_consent_required",
        "This needs a parent or guardian's OK first",
        scope=scope,
        age_known=band is not None,
    )


async def scope_allowed(db: Database, user_id: uuid.UUID, scope: str) -> bool:
    async with db.system_tx() as session:
        try:
            await require_scope(session, user_id, scope)
        except ApiError:
            return False
    return True


def strip_for_minor(props: Props) -> Props:
    return {
        k: v for k, v in props.items() if k not in MINOR_STRIPPED_PROPS and not k.startswith("utm_")
    }


class ConsentAwareAnalytics:
    """Wraps a sink: drops or trims server events by the learner's age and consent (R48)."""

    def __init__(self, inner: AnalyticsSink, db: Database) -> None:
        self.inner = inner
        self._db = db

    async def _policy(self, user_id: uuid.UUID) -> tuple[bool, bool]:
        """(minor, send) for this user."""
        async with self._db.system_tx() as session:
            band = (
                await session.execute(
                    text("select age_band from app.profiles where user_id = :u"), {"u": user_id}
                )
            ).one_or_none()
            if band is None:
                # The account is gone (deletion, merge): events about it carry no profile data.
                return False, True
            minor = band.age_band != "18p"
            if not minor:
                return False, True
            flags = await flag_service.server_flags(session)
            if not flags.get("minor.defer_sync_until_consent", False):
                return True, True
            return True, "account" in await granted_scopes(session, user_id)

    async def emit(self, name: str, user_id: uuid.UUID | None, props: Props) -> None:
        if user_id is not None:
            minor, send = await self._policy(user_id)
            if not send:
                log.debug("analytics_dropped", reason="awaiting_consent", analytics_event=name)
                return
            if minor:
                props = strip_for_minor(props)
        await self.inner.emit(name, user_id, props)

    async def alias(self, alias_user_id: uuid.UUID, canonical_user_id: uuid.UUID) -> None:
        await self.inner.alias(alias_user_id, canonical_user_id)

    def __getattr__(self, item: str) -> Any:
        # Tests read ``events`` from a wrapped FakeAnalyticsSink.
        return getattr(self.inner, item)
