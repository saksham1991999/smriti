"""The seeded shop and the local dev quests: names and wording are i18n keys that exist in both
catalogues, quest counters are ones the server counts, and no cosmetic is listed without art."""

from __future__ import annotations

import json
from functools import cache

import httpx
from sqlalchemy import text

from smriti_api.core.config import REPO_ROOT
from smriti_api.core.deps import AppServices
from smriti_api.services.game_ops import QUEST_COUNTERS
from tests.helpers import new_guest

LOCALES = REPO_ROOT / "packages" / "i18n" / "src" / "locales"
COSMETICS = ("pet_outfit", "plant_skin", "theme", "palace_room", "room_theme")


@cache
def _catalogue(locale: str, ns: str) -> dict[str, str]:
    data: dict[str, str] = json.loads((LOCALES / locale / f"{ns}.json").read_text("utf-8"))
    return data


def _exists(key: str) -> bool:
    ns, _, name = key.partition(":")
    return all(name in _catalogue(locale, ns) for locale in ("en", "hi"))


async def test_shop_items_have_names_in_both_languages_and_cosmetics_need_art(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    async with services.db.admin_tx() as session:
        rows = (
            await session.execute(
                text("select id, kind, name_key, asset_id from game.shop_items where active")
            )
        ).all()
    assert {r.id for r in rows} >= {"streak_freeze", "pet_treat"}
    for r in rows:
        if r.id in ("streak_freeze", "pet_treat"):
            assert r.name_key and _exists(r.name_key), r.id
        if r.kind in COSMETICS:
            assert r.asset_id is not None, f"{r.id}: a cosmetic needs its art first"
    s = await new_guest(client)
    shop = (await client.get("/v1/shop", headers=s.headers)).json()
    by_id = {i["id"]: i for i in shop["items"]}
    assert by_id["streak_freeze"]["name_key"] == "me_money:ME-17.freeze"
    assert by_id["pet_treat"]["name_key"] == "me_money:ME-17.treats"


async def test_dev_quests_use_known_counters_and_template_keys(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    async with services.db.admin_tx() as session:
        rows = (
            await session.execute(
                text("select id, period, spec, reward from game.quests where id like 'dev.%'")
            )
        ).all()
    # Present when the database was built by scripts/dev/db.sh (seed_dev.sql).
    for r in rows:
        spec = dict(r.spec)
        assert spec["counter"] in QUEST_COUNTERS, r.id
        assert int(spec["target"]) >= 1 and _exists(spec["title_key"]), r.id
        assert set(dict(r.reward)) <= {"gems", "xp"}, r.id
    if rows:
        s = await new_guest(client)
        quests = {q["id"]: q for q in (await client.get("/v1/quests", headers=s.headers)).json()}
        daily = [q for q in quests.values() if q["id"].startswith("dev.daily.")]
        assert len(daily) == 3 and all(q["title_key"] for q in daily)
        assert quests["dev.daily.lessons"]["title_key"] == "me_money:ME-20.template_lessons"
