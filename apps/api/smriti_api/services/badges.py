"""Badge awards (DB_SCHEMA §6 ``game.badges.rule``). Rules are data, so new badges need no code:

``{"metric": "<name>", "gte": <number>}`` where the metric is one of ``METRICS``. A badge is
earned once and kept. Badges and their names are config rows (seeded or published), never
written here.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

METRICS: dict[str, str] = {
    "current_streak": "select current_streak from game.user_stats where user_id = :u",
    "longest_streak": "select longest_streak from game.user_stats where user_id = :u",
    "xp_total": "select xp_total from game.user_stats where user_id = :u",
    "study_days": "select count(*) from learn.activity_days where user_id = :u and qualified",
    "lessons_completed": "select coalesce(sum(lessons_completed), 0) from learn.activity_days where user_id = :u",
    "cards_reviewed": "select coalesce(sum(cards_reviewed), 0) from learn.activity_days where user_id = :u",
    "topics_learned": "select count(*) from learn.topic_status where user_id = :u and status = 'learned'",
    "plant_growth": "select growth_points from game.plants where user_id = :u",
}


def rule_met(rule: dict[str, Any], metrics: dict[str, int]) -> bool:
    metric = rule.get("metric")
    threshold = rule.get("gte")
    if metric not in METRICS or not isinstance(threshold, int | float):
        return False
    return metrics.get(str(metric), 0) >= threshold


async def award_badges(session: AsyncSession, user_id: uuid.UUID) -> list[str]:
    """Award every badge whose rule is now met. Returns the newly earned badge ids."""
    pending = (
        await session.execute(
            text(
                "select b.id, b.rule from game.badges b where not exists ("
                " select 1 from game.user_badges ub where ub.user_id = :u and ub.badge_id = b.id)"
            ),
            {"u": user_id},
        )
    ).all()
    if not pending:
        return []
    needed = {str(dict(r.rule).get("metric")) for r in pending} & set(METRICS)
    metrics: dict[str, int] = {}
    for name in needed:
        value = (await session.execute(text(METRICS[name]), {"u": user_id})).scalar_one_or_none()
        metrics[name] = int(value or 0)
    earned = [r.id for r in pending if rule_met(dict(r.rule), metrics)]
    for badge_id in earned:
        await session.execute(
            text(
                "insert into game.user_badges (user_id, badge_id) values (:u, :b) on conflict do nothing"
            ),
            {"u": user_id, "b": badge_id},
        )
    return earned
