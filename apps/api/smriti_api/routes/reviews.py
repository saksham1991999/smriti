"""``POST /v1/reviews/queue`` (memory-labs §5.14, gap G25): the online path for "Fix next" and
"add cards to reviews". It applies the same ``cards_queued`` event the device writes to its
outbox, so the result and the sync state are identical either way."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import text

from smriti_api.core.deps import Client, CurrentUser, IdempotencyKey, Services
from smriti_api.core.errors import ApiError
from smriti_api.routes._idempotent import idempotent
from smriti_api.schemas import sync as s
from smriti_api.schemas.sync import CARD_REF_PATTERN, ConceptId
from smriti_api.services import game
from smriti_api.services.recompute import DEFAULT_TZ
from smriti_api.services.sync import apply_batch

router = APIRouter(prefix="/v1", tags=["reviews"])


class ReviewQueueRequest(BaseModel):
    source: Literal["lesson", "practice", "comeback", "mock_report", "practice_summary", "solution"]
    concept_ids: Annotated[list[ConceptId], Field(max_length=200)] = Field(default_factory=list)
    card_refs: Annotated[
        list[Annotated[str, Field(pattern=CARD_REF_PATTERN)]], Field(max_length=500)
    ] = Field(default_factory=list)


class ReviewQueueResponse(BaseModel):
    queued: int = Field(description="Cards started or moved into today's (or tomorrow's) queue")
    card_refs: list[str]
    state_version: int


@router.post(
    "/reviews/queue",
    response_model=ReviewQueueResponse,
    summary="Queue the review cards of some concepts (Fix next, add cards to reviews)",
)
async def queue_reviews(
    body: ReviewQueueRequest,
    services: Services,
    auth: CurrentUser,
    client: Client,
    key: IdempotencyKey,
) -> JSONResponse:
    async def run() -> ReviewQueueResponse:
        now = datetime.now(UTC)
        async with services.db.system_tx() as session:
            tz = (
                await session.execute(
                    text("select timezone from app.profiles where user_id = :u"),
                    {"u": auth.user_id},
                )
            ).scalar_one_or_none()
        result = await apply_batch(
            services.db,
            user_id=auth.user_id,
            device_id=client.device_id,
            events=[
                s.SyncEventIn(
                    event_id=game.event_id_for(auth.user_id, "reviews_queue", key),
                    type="cards_queued",
                    occurred_at=now,
                    tz=tz or DEFAULT_TZ,
                    payload=body.model_dump(),
                )
            ],
            app_variant=client.app_variant,
            now=now,
        )
        if result.rejected:
            raise ApiError(422, result.rejected[0].code, result.rejected[0].detail or "Not valid")
        refs = sorted(result.srs_changed)
        return ReviewQueueResponse(
            queued=len(refs), card_refs=refs, state_version=result.state_version
        )

    return await idempotent(
        services,
        scope="reviews_queue",
        subject=auth.user_id,
        key=key,
        body=body,
        fn=run,
        required=True,
    )
