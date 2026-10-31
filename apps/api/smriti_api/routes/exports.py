"""PDF exports (TRD §5.1 "Exports"; me-money §3.9) and, in development, signed local file reads."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Query, Response
from fastapi.responses import JSONResponse

from smriti_api.core.deps import CurrentUser, IdempotencyKey, Services
from smriti_api.core.errors import ApiError
from smriti_api.integrations.storage import LocalStorage, StorageError
from smriti_api.routes._idempotent import idempotent
from smriti_api.schemas import exports as x
from smriti_api.services import exports

router = APIRouter(prefix="/v1", tags=["exports"])
dev_router = APIRouter(prefix="/v1/dev", tags=["dev"])


@router.post(
    "/exports/pdf",
    response_model=x.ExportOut,
    status_code=202,
    summary="Make a PDF (formula sheet book or progress report); ready later (export_ready)",
)
async def create_pdf(
    body: x.PdfExportCreate, services: Services, auth: CurrentUser, key: IdempotencyKey
) -> JSONResponse:
    return await idempotent(
        services,
        scope="export_pdf",
        subject=auth.user_id,
        key=key,
        body=body,
        status=202,
        required=True,
        fn=lambda: exports.create_pdf(services.db, services.jobs, auth, body),
    )


@router.get("/exports/{export_id}", response_model=x.ExportOut, summary="Status and signed link")
async def get_export(export_id: uuid.UUID, services: Services, auth: CurrentUser) -> x.ExportOut:
    return await exports.get_export(services.db, services.integrations, auth, export_id)


@router.get("/exports", response_model=x.ExportList, summary="The student's exports (ME-23)")
async def list_exports(
    services: Services,
    auth: CurrentUser,
    kind: Annotated[Literal["pdf_book", "data_export"] | None, Query()] = None,
) -> x.ExportList:
    return await exports.list_exports(services.db, auth, kind)


@dev_router.get("/files/{bucket}/{key:path}", include_in_schema=False)
async def dev_file(
    bucket: Literal["uploads", "assets"],
    key: str,
    services: Services,
    expires: Annotated[int, Query()],
    sig: Annotated[str, Query(min_length=64, max_length=64)],
) -> Response:
    """Serves a LocalStorage object to a signed URL (development only; R2 signs its own URLs)."""
    storage = services.integrations.storage if services.integrations else None
    if not isinstance(storage, LocalStorage) or not storage.verify(bucket, key, expires, sig):
        raise ApiError(403, "invalid_signature", "This link is not valid")
    try:
        data = await storage.get(bucket, key)
    except StorageError as exc:
        raise ApiError(404, "not_found", "No such file") from exc
    media = "application/pdf" if key.endswith(".pdf") else "application/octet-stream"
    return Response(content=data, media_type=media, headers={"Cache-Control": "private, no-store"})
