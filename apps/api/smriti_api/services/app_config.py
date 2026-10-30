"""``GET /v1/config`` (TRD §5.1, §17): the variant, flags, version gate, free limits and prices.

Variants come from ``packages/config/variants/*.json`` (the same files the app builds read).
When that folder is missing (a server image without the monorepo), the ``ops.app_variants``
rows are used, and when the variant is unknown there too, a built-in all-exams default.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

import structlog
from sqlalchemy import text

from smriti_api.core.config import Settings
from smriti_api.core.db import Database
from smriti_api.schemas.api import AppVersionInfo, ConfigResponse, PriceInfo, VariantConfig
from smriti_api.services import flags as flag_service
from smriti_api.services.billing import family_offer
from smriti_api.services.flags import FlagContext, parse_version

log = structlog.get_logger(__name__)

DEFAULT_VARIANT = "all"
_VARIANT_ID = re.compile(r"^[a-z0-9_-]{1,32}$")
_PUBLIC_VARIANT_KEYS = {
    "id": "id",
    "appName": "app_name",
    "examIds": "exam_ids",
    "examProfileIds": "exam_profile_ids",
    "showExamSwitcher": "show_exam_switcher",
    "accentColor": "accent_color",
    "deepLinkPrefix": "deep_link_prefix",
    "products": "products",
    "revenuecatOfferingId": "revenuecat_offering_id",
    "phase": "phase",
    "scheme": "scheme",
}


@lru_cache(maxsize=4)
def load_variant_files(directory: str) -> dict[str, dict[str, Any]]:
    folder = Path(directory)
    out: dict[str, dict[str, Any]] = {}
    if not folder.is_dir():
        return out
    for path in sorted(folder.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            log.warning("variant_file_unreadable", file=path.name)
            continue
        if isinstance(data, dict) and isinstance(data.get("id"), str):
            out[data["id"]] = data
    return out


def _from_file(data: dict[str, Any]) -> VariantConfig:
    public = {snake: data[camel] for camel, snake in _PUBLIC_VARIANT_KEYS.items() if camel in data}
    public.setdefault("app_name", {"en": "Smriti", "hi": "Smriti"})
    public.setdefault("exam_ids", [])
    public.setdefault("exam_profile_ids", [])
    public.setdefault("show_exam_switcher", len(public["exam_profile_ids"]) > 1)
    return VariantConfig(source="packages/config", **public)


def _built_in(exam_profiles: list[str]) -> VariantConfig:
    return VariantConfig(
        id=DEFAULT_VARIANT,
        app_name={"en": "Smriti", "hi": "Smriti"},
        exam_ids=sorted({p.rsplit("-", 1)[0] for p in exam_profiles}),
        exam_profile_ids=exam_profiles,
        show_exam_switcher=True,
        source="built_in",
    )


async def build_config(
    db: Database,
    settings: Settings,
    *,
    variant: str | None,
    platform: str | None,
    app_version: str | None,
) -> ConfigResponse:
    variant_id = variant if variant and _VARIANT_ID.match(variant) else DEFAULT_VARIANT
    files = load_variant_files(settings.variants_dir)
    async with db.system_tx() as session:
        rows = {
            r.id: r
            for r in (
                await session.execute(
                    text(
                        "select id, exam_profile_ids, min_version, latest_version, config, active"
                        " from ops.app_variants order by id"
                    )
                )
            ).all()
        }
        flag_rows = await flag_service.load_flag_rows(session)
        products = (
            await session.execute(
                text(
                    "select id, platform, variant_id, store_product_id, price_paise, intro_price_paise, period,"
                    " entitlement, plan from billing.products where active"
                    " and (cast(:p as text) is null or platform = :p) order by id"
                ),
                {"p": platform},
            )
        ).all()
        active_profiles = list(
            (
                await session.execute(
                    text("select id from content.exam_profiles where is_active order by id")
                )
            ).scalars()
        )

    row = rows.get(variant_id) or rows.get(DEFAULT_VARIANT)
    if variant_id in files:
        cfg = _from_file(files[variant_id])
    elif row is not None and row.id == variant_id:
        cfg = VariantConfig(
            id=row.id,
            app_name=dict(row.config.get("app_name", {"en": "Smriti", "hi": "Smriti"})),
            exam_ids=sorted({p.rsplit("-", 1)[0] for p in row.exam_profile_ids}),
            exam_profile_ids=list(row.exam_profile_ids),
            show_exam_switcher=len(row.exam_profile_ids) > 1,
            source="database",
        )
    elif DEFAULT_VARIANT in files:
        cfg = _from_file(files[DEFAULT_VARIANT])
    else:
        cfg = _built_in(active_profiles)

    min_version = row.min_version if row is not None else "0.0.0"
    latest = row.latest_version if row is not None else "0.0.0"
    update_required = (
        parse_version(app_version) < parse_version(min_version) if app_version else None
    )
    flags = flag_service.evaluate(flag_rows, FlagContext(cfg.id, platform, app_version))
    free_limits = {k.removeprefix("free."): v for k, v in flags.items() if k.startswith("free.")}
    # A family plan's price and seats are owner flags; it is left out while they are unset.
    offer = family_offer(flags)
    pricing = []
    for p in products:
        if p.variant_id not in (None, cfg.id, DEFAULT_VARIANT):
            continue
        price = p.price_paise
        seats = None
        if p.plan == "family":
            price = offer.price_for(p.period) if offer else None
            if offer is None or price is None:
                continue
            seats = offer.seats
        pricing.append(
            PriceInfo(
                product_id=p.id,
                platform=p.platform,
                variant_id=p.variant_id,
                store_product_id=p.store_product_id,
                price_paise=price,
                intro_price_paise=p.intro_price_paise,
                period=p.period,
                entitlement=p.entitlement,
                plan=p.plan,
                seats=seats,
            )
        )
    return ConfigResponse(
        variant=cfg,
        variants=sorted(set(files) | {r.id for r in rows.values() if r.active}),
        app_version=AppVersionInfo(
            min_version=min_version, latest_version=latest, update_required=update_required
        ),
        flags=flags,
        free_limits=free_limits,
        pricing=pricing,
        content_base_url=settings.content_base_url,
        server_time=datetime.now(UTC),
    )
