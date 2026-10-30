"""Data jobs on the analytics store (IMPLEMENTATION_PLAN G-11).

- **Per-user FSRS optimisation.** For each student with enough new reviews
  (``memory.fsrs.optimise_min_reviews`` since the last fit, or in all for the first), fit the
  FSRS parameters to their own review history and store them in ``learn.fsrs_params``; the
  scheduler and the weak-area job read them from there. The fit is py-fsrs's ``Optimizer``,
  which needs its optional extra (``fsrs[optimizer]``: torch and pandas). Without the extra the
  job reports ``optimizer_unavailable`` and changes nothing, so every student keeps the default
  parameters.
- **IRT calibration (skeleton).** Collects the first-attempt response matrix for questions with
  at least ``irt.min_responses`` answers and hands it to an ``IrtCalibrator``. No calibrator is
  chosen yet, so the job reports ``calibrator_unavailable`` and writes nothing; one that returns
  item parameters gets them written to ``content.questions`` (``difficulty`` is IRT b,
  ``discrimination`` is a, DB_SCHEMA §4).

Both thresholds are owner flags; while unset the jobs report ``threshold_unset``.
"""

from __future__ import annotations

import importlib.util
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Protocol

import structlog
from sqlalchemy import text

from smriti_api.core.db import Database
from smriti_api.core.logging import hash_user_id
from smriti_api.integrations.analytics_store import AnalyticsStore, ResponseRow, ReviewRow
from smriti_api.services.srs import TS_FSRS_DEFAULT_RETENTION
from smriti_api.services.usage import load_flags

if TYPE_CHECKING:
    from smriti_api.services.jobs import JobDeps

log = structlog.get_logger(__name__)

OPTIMIZER_MODULES = ("torch", "pandas", "tqdm")

# (review logs) -> fitted parameters
FsrsFit = Callable[[Sequence[ReviewRow]], Sequence[float]]


def optimizer_available() -> bool:
    """py-fsrs ships ``Optimizer`` as a stub that raises unless its optional extra is installed."""
    return all(importlib.util.find_spec(m) is not None for m in OPTIMIZER_MODULES)


def py_fsrs_fit(rows: Sequence[ReviewRow]) -> Sequence[float]:
    from fsrs import Optimizer, Rating, ReviewLog

    ids: dict[str, int] = {}
    logs = [
        ReviewLog(
            card_id=ids.setdefault(r.card_ref, len(ids) + 1),
            rating=Rating(r.rating),
            review_datetime=r.reviewed_at.astimezone(UTC),
            review_duration=r.duration_ms,
        )
        for r in rows
    ]
    params: Sequence[float] = Optimizer(logs).compute_optimal_parameters()
    return params


@dataclass(frozen=True)
class JobReport:
    status: str
    eligible: int = 0
    done: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {"status": self.status, "eligible": self.eligible, "done": self.done}


async def fsrs_optimise(
    db: Database, store: AnalyticsStore, *, fit: FsrsFit | None = None
) -> JobReport:
    async with db.system_tx() as session:
        flags = await load_flags(session)
        fitted = {
            r.user_id: int(r.review_count)
            for r in (
                await session.execute(text("select user_id, review_count from learn.fsrs_params"))
            ).all()
        }
    min_reviews = flags.int_or_none("memory.fsrs.optimise_min_reviews")
    if min_reviews is None:
        return JobReport("threshold_unset")
    counts = await store.review_counts()
    eligible = [u for u, n in counts.items() if n - fitted.get(u, 0) >= min_reviews]
    if fit is None:
        if not optimizer_available():
            log.warning("fsrs_optimizer_unavailable", eligible=len(eligible))
            return JobReport("optimizer_unavailable", eligible=len(eligible))
        fit = py_fsrs_fit
    done = 0
    for user_id in eligible:
        rows = await store.review_logs(user_id)
        if len(rows) < min_reviews:
            continue
        try:
            weights = [float(w) for w in fit(rows)]
        except (ValueError, RuntimeError, ArithmeticError) as exc:
            log.warning(
                "fsrs_fit_failed", user=hash_user_id(user_id), error_type=type(exc).__name__
            )
            continue
        async with db.system_tx() as session:
            await session.execute(
                text(
                    """
                    insert into learn.fsrs_params (user_id, weights, desired_retention, review_count, optimised_at)
                    values (:u, :w, :r, :n, :at)
                    on conflict (user_id) do update set
                      weights = excluded.weights, review_count = excluded.review_count,
                      optimised_at = excluded.optimised_at
                    """
                ),
                {
                    "u": user_id,
                    "w": weights,
                    "r": TS_FSRS_DEFAULT_RETENTION,
                    "n": len(rows),
                    "at": datetime.now(UTC),
                },
            )
        done += 1
    return JobReport("ok", eligible=len(eligible), done=done)


# --- IRT --------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class ItemParams:
    difficulty: float  # IRT b
    discrimination: float | None = None  # IRT a (2PL); None for a 1PL fit


class IrtCalibrator(Protocol):
    name: str

    def fit(self, responses: Sequence[ResponseRow]) -> dict[str, ItemParams]: ...


async def irt_calibrate(
    db: Database, store: AnalyticsStore, *, calibrator: IrtCalibrator | None = None
) -> JobReport:
    async with db.system_tx() as session:
        flags = await load_flags(session)
    min_responses = flags.int_or_none("irt.min_responses")
    if min_responses is None:
        return JobReport("threshold_unset")
    counts = await store.question_counts(min_responses)
    if calibrator is None:
        return JobReport("calibrator_unavailable", eligible=len(counts))
    if not counts:
        return JobReport("ok")
    items = calibrator.fit(await store.responses([c.question_id for c in counts]))
    eligible = {c.question_id for c in counts}
    done = 0
    async with db.system_tx() as session:
        for qid, item in sorted(items.items()):
            if qid not in eligible:
                continue
            await session.execute(
                text(
                    "update content.questions set difficulty = :b,"
                    " discrimination = coalesce(:a, discrimination) where id = :q"
                ),
                {"b": round(item.difficulty, 2), "a": item.discrimination, "q": qid},
            )
            done += 1
    log.info("irt_calibrated", calibrator=calibrator.name, items=done)
    return JobReport("ok", eligible=len(counts), done=done)


async def fsrs_optimise_job(deps: JobDeps) -> dict[str, Any]:
    if deps.analytics_store is None:
        return JobReport("store_unavailable").as_dict()
    return (await fsrs_optimise(deps.db, deps.analytics_store)).as_dict()


async def irt_calibrate_job(deps: JobDeps) -> dict[str, Any]:
    if deps.analytics_store is None:
        return JobReport("store_unavailable").as_dict()
    return (await irt_calibrate(deps.db, deps.analytics_store)).as_dict()
