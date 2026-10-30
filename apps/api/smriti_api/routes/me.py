"""``/v1/me``: the student's profile and the home summary."""

from __future__ import annotations

from fastapi import APIRouter

from smriti_api.core.deps import CurrentUser, Services
from smriti_api.schemas.api import ExamsPut, MePatch, MeResponse, SummaryResponse
from smriti_api.services import me as me_service
from smriti_api.services.state import build_summary

router = APIRouter(prefix="/v1/me", tags=["me"])


@router.get("", response_model=MeResponse, summary="The caller's profile")
async def get_me(services: Services, auth: CurrentUser) -> MeResponse:
    return await me_service.get_me(services.db, auth)


@router.patch("", response_model=MeResponse, summary="Update profile fields and settings")
async def patch_me(body: MePatch, services: Services, auth: CurrentUser) -> MeResponse:
    return await me_service.patch_me(services.db, auth, body)


@router.put("/exams", response_model=MeResponse, summary="Replace the caller's exams")
async def put_exams(body: ExamsPut, services: Services, auth: CurrentUser) -> MeResponse:
    return await me_service.put_exams(services.db, auth, body)


@router.get(
    "/summary",
    response_model=SummaryResponse,
    summary="Home summary: today, streak, plant, pet, wallet",
)
async def get_summary(services: Services, auth: CurrentUser) -> SummaryResponse:
    return SummaryResponse.model_validate(await build_summary(services.db, auth))
