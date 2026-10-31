"""The guardian consent notice (AUTH-20 "Read the full notice"; auth flow §6.10).

The notice's version and its URL in each language come from the owner flags
``auth.consent_notice_version`` and ``auth.consent_notice_url`` (legal publishes the notice; no copy
is written here). Until the version is set the apps keep sending the AUTH-20 copy version they
showed. Once it is set, a consent, an AUTH-27 acceptance or a managed child must record that
version, so the stored consent always names the notice the guardian could read."""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any, Literal

from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.errors import ApiError
from smriti_api.schemas import guardian as g
from smriti_api.services.usage import Flags, load_flags

_VERSION = re.compile(r"^[A-Za-z0-9._-]{1,40}$")
_URL = re.compile(r"^https://\S+$")


def current(flags: Flags, locale: Literal["en", "hi"]) -> g.ConsentNoticeOut:
    raw_version = flags.get("auth.consent_notice_version")
    version = raw_version if isinstance(raw_version, str) and _VERSION.match(raw_version) else None
    urls: Mapping[str, Any] = flags.get("auth.consent_notice_url") or {}
    url = urls.get(locale) if isinstance(urls, Mapping) else None
    if not (isinstance(url, str) and _URL.match(url)):
        url = None
    return g.ConsentNoticeOut(
        version=version, url=url, locale=locale, published=version is not None and url is not None
    )


async def check_version(session: AsyncSession, shown: str) -> None:
    """409 ``consent_notice_outdated`` when a published version is set and the client recorded
    another one (the guardian saw an older notice: reload it and ask again)."""
    notice = current(await load_flags(session), "en")
    if notice.version is not None and shown != notice.version:
        raise ApiError(
            409,
            "consent_notice_outdated",
            "The consent notice has changed. Show the current one and ask again.",
            current_version=notice.version,
        )
