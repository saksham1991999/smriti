"""``POST /v1/analytics/events``: the apps' analytics batches (packages/analytics ``httpTransport``)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header

from smriti_api.core.deps import Client, CurrentUser, Services, rate_limited
from smriti_api.core.errors import ApiError
from smriti_api.schemas import analytics_ingest as ai
from smriti_api.services import analytics_ingest

router = APIRouter(prefix="/v1", tags=["analytics"])


def _size_cap(content_length: Annotated[int | None, Header()] = None) -> None:
    """Refuses a batch before it is read: no length (a chunked body) or more than the cap."""
    if content_length is None:
        raise ApiError(411, "length_required", "Send a Content-Length")
    if content_length > ai.MAX_BODY_BYTES:
        raise ApiError(413, "batch_too_large", "Send fewer events", limit=ai.MAX_BODY_BYTES)


@router.post(
    "/analytics/events",
    response_model=ai.EventBatchOut,
    dependencies=[
        rate_limited("analytics", "rate_analytics_per_min", 60),
        Depends(_size_cap),
    ],
    summary="A batch of analytics events: checked against the catalogue, age and consent policy",
)
async def post_events(
    batch: ai.EventBatchIn, services: Services, auth: CurrentUser, client: Client
) -> ai.EventBatchOut:
    store = services.integrations.event_store if services.integrations else None
    if store is None:
        # The client keeps the batch and retries later (it drops a batch only on a 400 or 422).
        raise ApiError(503, "analytics_unavailable", "Analytics isn't set up here")
    return await analytics_ingest.ingest(services.db, store, auth, batch, client.device_id)
