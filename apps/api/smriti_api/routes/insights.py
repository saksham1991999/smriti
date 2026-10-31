"""Learning-science views (G-8, TRD §9.6): predicted weak areas, tonight's sleep review, the
interleaved practice builder and the metacognitive calibration dashboard."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from smriti_api.core.deps import CurrentUser, IdempotencyKey, Services
from smriti_api.routes._idempotent import idempotent
from smriti_api.schemas import analytics_summary as asum
from smriti_api.schemas import practice as p
from smriti_api.services import analytics_summary as analytics_summary_service
from smriti_api.services import learning_science as ls

router = APIRouter(prefix="/v1", tags=["insights"])


@router.get(
    "/insights/weak-areas",
    response_model=ls.WeakAreasOut,
    summary="Topics whose cards are predicted to drop below your target recall soon",
)
async def weak_areas(services: Services, auth: CurrentUser) -> ls.WeakAreasOut:
    return await ls.weak_areas(services.db, auth)


@router.get(
    "/insights/sleep-review",
    response_model=ls.SleepReviewOut,
    summary="Tonight's sleep review: when to remind and the hardest due cards (adults, Pro)",
)
async def sleep_review(services: Services, auth: CurrentUser) -> ls.SleepReviewOut:
    return await ls.sleep_review(services.db, auth)


@router.get(
    "/insights/calibration",
    response_model=ls.CalibrationOut,
    summary="Confidence against correctness, from your own answers",
)
async def calibration(services: Services, auth: CurrentUser) -> ls.CalibrationOut:
    return await ls.calibration(services.db, auth)


@router.post(
    "/practice/interleaved",
    response_model=p.PracticeSession,
    summary="Start a mixed drill across chapters or subjects you have learned (practice §5.3)",
)
async def interleaved(
    body: ls.InterleavedIn, services: Services, auth: CurrentUser, key: IdempotencyKey
) -> JSONResponse:
    # Also idempotent by body.session_id.
    return await idempotent(
        services,
        scope="practice_interleaved",
        subject=auth.user_id,
        key=key,
        body=body,
        fn=lambda: ls.build_interleaved(services.db, auth, body),
    )


@router.get(
    "/analytics/summary",
    response_model=asum.AnalyticsSummaryOut,
    tags=["analytics"],
    summary="PRC-14: readiness, speed, confidence and mistake cards from your own answers",
)
async def analytics_summary(
    services: Services,
    auth: CurrentUser,
    exam: Annotated[str | None, Query(max_length=200)] = None,
    period: asum.Period = "30d",
) -> asum.AnalyticsSummaryOut:
    return await analytics_summary_service.summary(services.db, auth, exam, period)
