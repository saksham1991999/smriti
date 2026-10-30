"""Practice, PYQs and the daily challenge (docs/flows/practice.md §5, §8, §12.2)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Path, Query
from fastapi.responses import JSONResponse

from smriti_api.core.deps import Client, CurrentUser, IdempotencyKey, Services
from smriti_api.routes._idempotent import idempotent
from smriti_api.schemas import practice as p
from smriti_api.services import daily_challenge, practice, practice_views

router = APIRouter(prefix="/v1", tags=["practice"])

Exam = Annotated[str | None, Query(max_length=200, description="Exam profile; default: primary")]
SessionId = Annotated[uuid.UUID, Path()]


@router.get(
    "/practice/limits", response_model=p.Limits, summary="Free counters for today and this week"
)
async def get_limits(services: Services, auth: CurrentUser) -> p.Limits:
    return await practice.limits(services.db, auth)


@router.get("/practice/hub", response_model=p.PracticeHub, summary="The practice hub in one call")
async def get_hub(services: Services, auth: CurrentUser, exam: Exam = None) -> p.PracticeHub:
    return await practice_views.hub(services.db, auth, exam)


@router.get(
    "/practice/weak-spots", response_model=p.WeakSpots, summary="Weak spots from mastery (PRC-02)"
)
async def get_weak_spots(services: Services, auth: CurrentUser, exam: Exam = None) -> p.WeakSpots:
    return await practice_views.get_weak_spots(services.db, auth, exam)


@router.get(
    "/practice/drill",
    response_model=p.DrillPreview,
    summary="Pick drill questions for a concept or topic without starting a session",
)
async def get_drill(
    services: Services,
    auth: CurrentUser,
    exam: Exam = None,
    concept: Annotated[list[str] | None, Query(max_length=50)] = None,
    topic: Annotated[str | None, Query(max_length=200)] = None,
    count: Annotated[int, Query(ge=1, le=50)] = 10,
) -> p.DrillPreview:
    return await practice.drill_preview(
        services.db, auth, exam=exam, concepts=concept, topic=topic, count=count
    )


@router.post(
    "/practice/sessions",
    response_model=p.PracticeSession,
    status_code=201,
    summary="Start a drill, PYQ or chapter-test session, sized to today's free questions",
)
async def create_session(
    body: p.SessionCreate, services: Services, auth: CurrentUser
) -> p.PracticeSession:
    return await practice.create_session(services.db, auth, body)


@router.get(
    "/practice/sessions", response_model=list[p.SessionSummary], summary="Recent sessions (PRC-16)"
)
async def list_sessions(
    services: Services,
    auth: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    before: Annotated[datetime | None, Query()] = None,
) -> list[p.SessionSummary]:
    return await practice.list_sessions(services.db, auth, limit=limit, before=before)


@router.get(
    "/practice/sessions/{session_id}", response_model=p.PracticeSession, summary="A session"
)
async def get_session(
    session_id: SessionId, services: Services, auth: CurrentUser
) -> p.PracticeSession:
    return await practice.get_session(services.db, auth, session_id)


@router.post(
    "/practice/sessions/{session_id}/answers",
    response_model=p.AnswerResult,
    summary="Check an answer on the server (online path) and record it",
)
async def submit_answer(
    session_id: SessionId,
    body: p.AnswerSubmit,
    services: Services,
    auth: CurrentUser,
    client: Client,
    key: IdempotencyKey,
) -> JSONResponse:
    async def run() -> p.AnswerResult:
        return await practice.submit_answer(
            services.db,
            auth,
            session_id,
            body,
            device_id=client.device_id,
            app_variant=client.app_variant,
        )

    return await idempotent(
        services,
        scope=f"practice_answer:{session_id}",
        subject=auth.user_id,
        key=key,
        body=body,
        fn=run,
    )


@router.post(
    "/practice/sessions/{session_id}/complete",
    response_model=p.PracticeSession,
    summary="End a session (XP for its correct answers)",
)
async def complete_session(
    session_id: SessionId,
    body: p.SessionComplete,
    services: Services,
    auth: CurrentUser,
    client: Client,
) -> p.PracticeSession:
    return await practice.complete_session(
        services.db,
        auth,
        session_id,
        body,
        device_id=client.device_id,
        app_variant=client.app_variant,
    )


# --- PYQ ------------------------------------------------------------------------------------------


@router.get("/pyq/papers", response_model=list[p.PyqPaper], summary="Past papers of an exam")
async def list_papers(
    services: Services,
    auth: CurrentUser,
    exam: Exam = None,
    year: Annotated[int | None, Query(ge=1950, le=2100)] = None,
    session: Annotated[str | None, Query(max_length=100)] = None,
) -> list[p.PyqPaper]:
    return await practice_views.papers(services.db, auth, exam, year, session)


@router.get(
    "/pyq/papers/{paper_id}", response_model=p.PyqPaperDetail, summary="A paper with its questions"
)
async def get_paper(
    paper_id: Annotated[str, Path(max_length=200)], services: Services, auth: CurrentUser
) -> p.PyqPaperDetail:
    return await practice_views.paper(services.db, auth, paper_id)


@router.get("/pyq", response_model=list[p.PyqQuestion], summary="PYQs with the PRC-08 filters")
async def list_pyq(
    services: Services,
    auth: CurrentUser,
    exam: Exam = None,
    year: Annotated[list[int] | None, Query()] = None,
    session: Annotated[str | None, Query(max_length=100)] = None,
    subject: Annotated[str | None, Query(max_length=200)] = None,
    chapter: Annotated[str | None, Query(max_length=200)] = None,
    topic: Annotated[str | None, Query(max_length=200)] = None,
    difficulty: Annotated[Literal["easy", "medium", "hard"] | None, Query()] = None,
    type: Annotated[str | None, Query(max_length=32)] = None,
    status: Annotated[Literal["not_tried", "wrong", "correct"] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> list[p.PyqQuestion]:
    return await practice_views.pyq_questions(
        services.db,
        auth,
        exam=exam,
        year=year,
        session_label=session,
        subject=subject,
        chapter=chapter,
        topic=topic,
        difficulty=difficulty,
        qtype=type,
        status=status,
        limit=limit,
        offset=offset,
    )


# --- daily challenge ----------------------------------------------------------------------------

ChallengeId = Annotated[uuid.UUID, Path()]


@router.get(
    "/daily-challenge/today",
    response_model=p.DailyChallenge,
    summary="Today's challenge (rolls at 00:00 IST); the question shows once started",
)
async def challenge_today(
    services: Services, auth: CurrentUser, exam: Exam = None
) -> p.DailyChallenge:
    return await daily_challenge.today(services.db, auth, exam)


@router.post(
    "/daily-challenge/{challenge_id}/start",
    response_model=p.DailyChallenge,
    summary="Start the challenge: the server clock starts",
)
async def challenge_start(
    challenge_id: ChallengeId, services: Services, auth: CurrentUser
) -> p.DailyChallenge:
    return await daily_challenge.start(services.db, auth, challenge_id)


@router.post(
    "/daily-challenge/{challenge_id}/answer",
    response_model=p.DailyChallenge,
    summary="Answer once; scored on the server, qualifies today's streak day",
)
async def challenge_answer(
    challenge_id: ChallengeId,
    body: p.DailyChallengeAnswer,
    services: Services,
    auth: CurrentUser,
    client: Client,
    key: IdempotencyKey,
) -> JSONResponse:
    async def run() -> p.DailyChallenge:
        return await daily_challenge.answer(
            services.db,
            auth,
            challenge_id,
            body,
            device_id=client.device_id,
            app_variant=client.app_variant,
        )

    return await idempotent(
        services, scope=f"daily:{challenge_id}", subject=auth.user_id, key=key, body=body, fn=run
    )


@router.get(
    "/daily-challenge/{challenge_id}/leaderboard",
    response_model=p.DailyLeaderboard,
    summary="Ranks once enough players have played (R31 identities)",
)
async def challenge_leaderboard(
    challenge_id: ChallengeId,
    services: Services,
    auth: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> p.DailyLeaderboard:
    return await daily_challenge.leaderboard(services.db, auth, challenge_id, limit)
