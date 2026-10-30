"""Parent mode, Phase 3 (me-money §4.7 and §10 "Parent links, limits, time requests").

Guardian endpoints need a signed-in guardian with a live link and an active consent for the
child (otherwise 404 ``learner_not_found``). The child's own endpoints are under ``/v1/me``.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query, Response
from fastapi.responses import JSONResponse

from smriti_api.core.auth import AuthContext
from smriti_api.core.deps import IdempotencyKey, Services, signed_in
from smriti_api.routes._idempotent import idempotent
from smriti_api.schemas import parent as p
from smriti_api.services import parent_mode

router = APIRouter(tags=["parent"])

Guardian = Annotated[AuthContext, signed_in("parent_mode")]
Child = Annotated[AuthContext, signed_in("parent_mode")]


@router.get(
    "/v1/guardian/dashboard",
    response_model=p.Dashboard,
    summary="SET-14 child cards: pet, minutes this week, streak, practice line, Needs you",
)
async def dashboard(services: Services, auth: Guardian) -> p.Dashboard:
    return await parent_mode.dashboard(services.db, auth)


@router.get(
    "/v1/guardian/learners/{learner_id}/report",
    response_model=p.WeekReport,
    summary="SET-15 weekly report (counts and topic names only); week is any day in that week",
)
async def report(
    learner_id: uuid.UUID,
    services: Services,
    auth: Guardian,
    week: Annotated[date | None, Query()] = None,
) -> p.WeekReport:
    return await parent_mode.report(services.db, auth, learner_id, week)


@router.get(
    "/v1/guardian/learners/{learner_id}/controls",
    response_model=p.ControlsOut,
    summary="SET-14 and SET-16 settings for one child",
)
async def get_controls(learner_id: uuid.UUID, services: Services, auth: Guardian) -> p.ControlsOut:
    return await parent_mode.get_controls(services.db, auth, learner_id)


@router.put(
    "/v1/guardian/learners/{learner_id}/controls",
    response_model=p.ControlsOut,
    summary="Set time limits, allowed hours, tutor, social, Picture rhymes and the weekly report",
)
async def put_controls(
    learner_id: uuid.UUID,
    body: p.Controls,
    services: Services,
    auth: Guardian,
    key: IdempotencyKey,
) -> JSONResponse:
    return await idempotent(
        services,
        scope="parent_controls",
        subject=auth.user_id,
        key=key,
        body={"learner_id": str(learner_id), **body.model_dump(mode="json")},
        fn=lambda: parent_mode.put_controls(services.db, auth, learner_id, body),
    )


@router.post(
    "/v1/guardian/time-requests/{request_id}/decision",
    response_model=p.TimeRequestOut,
    summary="SET-14 [Allow 15 min] or [Not today] on a child's SET-19 ask",
)
async def decide_time(
    request_id: uuid.UUID,
    body: p.Decision,
    services: Services,
    auth: Guardian,
    key: IdempotencyKey,
) -> JSONResponse:
    return await idempotent(
        services,
        scope="parent_time_decision",
        subject=auth.user_id,
        key=key,
        body={"request_id": str(request_id), **body.model_dump(mode="json")},
        fn=lambda: parent_mode.decide_time(services.db, auth, request_id, body),
    )


@router.get(
    "/v1/guardian/learners/{learner_id}/friends",
    response_model=list[p.ParentFriend],
    summary="The child's friends, as the child sees them (tutor-social B13)",
)
async def friends(
    learner_id: uuid.UUID, services: Services, auth: Guardian
) -> list[p.ParentFriend]:
    return await parent_mode.friends(services.db, auth, learner_id)


@router.delete(
    "/v1/guardian/learners/{learner_id}/friends/{friend_id}",
    status_code=204,
    summary="Remove a friend for the child (silent, like the child's own Remove)",
)
async def remove_friend(
    learner_id: uuid.UUID, friend_id: uuid.UUID, services: Services, auth: Guardian
) -> Response:
    await parent_mode.remove_friend(services.db, auth, learner_id, friend_id)
    return Response(status_code=204)


@router.get(
    "/v1/me/limits",
    response_model=p.MyLimits,
    summary="The child's own limits for today, cached by the device to enforce SET-16 offline",
)
async def my_limits(services: Services, auth: Child) -> p.MyLimits:
    return await parent_mode.my_limits(services.db, auth)


@router.post(
    "/v1/me/time-requests",
    response_model=p.TimeRequestOut,
    status_code=201,
    summary="SET-19 [Ask for 15 more minutes]: pushes every linked guardian",
)
async def ask_for_time(services: Services, auth: Child, key: IdempotencyKey) -> JSONResponse:
    return await idempotent(
        services,
        scope="time_request",
        subject=auth.user_id,
        key=key,
        body=None,
        fn=lambda: parent_mode.ask_for_time(services.db, auth),
        status=201,
    )
