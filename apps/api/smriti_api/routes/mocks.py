"""Mocks: catalogue, attempts, autosave, submission and reports (docs/flows/practice.md §6, §8,
§12.2)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Path, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from smriti_api.core.deps import Client, CurrentUser, IdempotencyKey, Services
from smriti_api.routes._idempotent import idempotent
from smriti_api.schemas import mocks as m
from smriti_api.services import mocks

router = APIRouter(prefix="/v1", tags=["mocks"])

Exam = Annotated[str | None, Query(max_length=200, description="Exam profile; default: primary")]
MockId = Annotated[str, Path(min_length=1, max_length=300)]
AttemptId = Annotated[uuid.UUID, Path()]


class PauseIn(BaseModel):
    # When the device went away (app killed, a call), if it knows; the server clamps it.
    at: datetime | None = None


@router.get("/mocks", response_model=list[m.MockCard], summary="Mocks for an exam (MOCK-01)")
async def list_mocks(services: Services, auth: CurrentUser, exam: Exam = None) -> list[m.MockCard]:
    return await mocks.list_mocks(services.db, auth, exam)


@router.post(
    "/mocks/generate",
    response_model=m.Attempt,
    status_code=201,
    summary="Start a custom weak-area mock (Pro) or a timed chapter mock",
)
async def generate_mock(
    body: m.GenerateMock, services: Services, auth: CurrentUser, client: Client
) -> m.Attempt:
    return await mocks.generate(services.db, auth, body, client.device_id)


@router.get(
    "/mocks/{mock_id}", response_model=m.MockDetail, summary="Mock detail from its blueprint"
)
async def get_mock(mock_id: MockId, services: Services, auth: CurrentUser) -> m.MockDetail:
    return await mocks.get_mock(services.db, auth, mock_id)


@router.post(
    "/mocks/{mock_id}/attempts",
    response_model=m.Attempt,
    status_code=201,
    summary="Begin a mock: the timer starts and the paper is pinned",
)
async def start_attempt(
    mock_id: MockId, body: m.AttemptCreate, services: Services, auth: CurrentUser, client: Client
) -> m.Attempt:
    return await mocks.start(services.db, auth, mock_id, body, client.device_id)


@router.get("/attempts", response_model=list[m.AttemptSummary], summary="Past attempts (MOCK-25)")
async def list_attempts(
    services: Services,
    auth: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    before: Annotated[datetime | None, Query()] = None,
) -> list[m.AttemptSummary]:
    return await mocks.list_attempts(services.db, auth, limit, before)


@router.get(
    "/attempts/{attempt_id}",
    response_model=m.Attempt,
    summary="An attempt with its paper and saved answers, for resume or takeover",
)
async def get_attempt(
    attempt_id: AttemptId, services: Services, auth: CurrentUser, client: Client
) -> m.Attempt:
    return await mocks.get_attempt(services.db, auth, attempt_id, client.device_id)


@router.put(
    "/attempts/{attempt_id}/answers",
    response_model=m.SaveResult,
    summary="Autosave changed answers; the newest client_updated_at wins",
)
async def save_answers(
    attempt_id: AttemptId, body: m.AnswersPut, services: Services, auth: CurrentUser, client: Client
) -> m.SaveResult:
    return await mocks.save_answers(services.db, auth, attempt_id, body, client.device_id)


@router.post(
    "/attempts/{attempt_id}/pause",
    response_model=m.Attempt,
    summary="Pause the timer (practice time policy only)",
)
async def pause_attempt(
    attempt_id: AttemptId, body: PauseIn, services: Services, auth: CurrentUser, client: Client
) -> m.Attempt:
    return await mocks.pause(services.db, auth, attempt_id, body.at, client.device_id)


@router.post("/attempts/{attempt_id}/resume", response_model=m.Attempt, summary="Resume (MOCK-14)")
async def resume_attempt(
    attempt_id: AttemptId, services: Services, auth: CurrentUser, client: Client
) -> m.Attempt:
    return await mocks.resume(services.db, auth, attempt_id, client.device_id)


@router.post(
    "/attempts/{attempt_id}/takeover",
    response_model=m.Attempt,
    summary="Continue the attempt on this device",
)
async def takeover_attempt(
    attempt_id: AttemptId, services: Services, auth: CurrentUser, client: Client
) -> m.Attempt:
    return await mocks.takeover(services.db, auth, attempt_id, client.device_id)


@router.post(
    "/attempts/{attempt_id}/sections/{section_code}/submit",
    response_model=m.Attempt,
    summary="Submit the open section early, where the blueprint allows it",
)
async def submit_section(
    attempt_id: AttemptId,
    section_code: Annotated[str, Path(min_length=1, max_length=64)],
    services: Services,
    auth: CurrentUser,
    client: Client,
) -> m.Attempt:
    return await mocks.submit_section(services.db, auth, attempt_id, section_code, client.device_id)


@router.post(
    "/attempts/{attempt_id}/abandon",
    response_model=m.Attempt,
    summary="Leave the mock and discard it (MOCK-15)",
)
async def abandon_attempt(
    attempt_id: AttemptId, services: Services, auth: CurrentUser, client: Client
) -> m.Attempt:
    return await mocks.abandon(services.db, auth, attempt_id, client.device_id)


@router.post(
    "/attempts/{attempt_id}/submit",
    response_model=m.Report,
    summary="Submit the paper; scored on the server with the blueprint's marking",
)
async def submit_attempt(
    attempt_id: AttemptId,
    services: Services,
    auth: CurrentUser,
    client: Client,
    key: IdempotencyKey,
) -> JSONResponse:
    async def run() -> m.Report:
        return await mocks.submit(services.db, auth, attempt_id, client.device_id)

    return await idempotent(
        services,
        scope=f"mock_submit:{attempt_id}",
        subject=auth.user_id,
        key=key,
        body=None,
        fn=run,
    )


@router.get(
    "/attempts/{attempt_id}/report",
    response_model=m.Report,
    summary="The report; deeper sections are Pro (free.mock_report_sections)",
)
async def get_report(attempt_id: AttemptId, services: Services, auth: CurrentUser) -> m.Report:
    return await mocks.report(services.db, auth, attempt_id)


@router.get(
    "/attempts/{attempt_id}/solutions",
    response_model=m.Solutions,
    summary="Keys and solutions after submit (MOCK-22)",
)
async def get_solutions(
    attempt_id: AttemptId,
    services: Services,
    auth: CurrentUser,
    locale: Annotated[m.Locale | None, Query()] = None,
) -> m.Solutions:
    return await mocks.solutions(services.db, auth, attempt_id, locale)
