"""``/v1/catalog/*`` and ``/v1/content/*``: public catalogue metadata, manifests and, in local
mode, the published content files themselves."""

from __future__ import annotations

import mimetypes
from typing import Annotated, Literal

from fastapi import APIRouter, Path, Query, Response
from fastapi.responses import FileResponse

from smriti_api.core.deps import Services
from smriti_api.schemas.api import ChapterOut, ExamOut, ManifestResponse, SubjectOut, TopicOut
from smriti_api.services import catalog

router = APIRouter(prefix="/v1", tags=["catalog"])

CatalogId = Annotated[str, Path(min_length=1, max_length=200)]
PUBLIC_CACHE = "public, max-age=300"


@router.get("/catalog/exams", response_model=list[ExamOut], summary="Exams and their cycles")
async def exams(services: Services, response: Response) -> list[ExamOut]:
    response.headers["Cache-Control"] = PUBLIC_CACHE
    return await catalog.list_exams(services.db)


@router.get(
    "/catalog/subjects",
    response_model=list[SubjectOut],
    summary="Subjects, optionally for one exam",
)
async def subjects(
    services: Services,
    response: Response,
    exam: Annotated[str | None, Query(max_length=64, description="Exam profile id")] = None,
) -> list[SubjectOut]:
    response.headers["Cache-Control"] = PUBLIC_CACHE
    return await catalog.list_subjects(services.db, exam)


@router.get(
    "/catalog/chapters/{chapter_id}", response_model=ChapterOut, summary="A chapter and its topics"
)
async def chapter(chapter_id: CatalogId, services: Services, response: Response) -> ChapterOut:
    response.headers["Cache-Control"] = PUBLIC_CACHE
    return await catalog.get_chapter(services.db, chapter_id)


@router.get(
    "/catalog/topics/{topic_id}", response_model=TopicOut, summary="A topic with its bundle refs"
)
async def topic(topic_id: CatalogId, services: Services, response: Response) -> TopicOut:
    response.headers["Cache-Control"] = PUBLIC_CACHE
    return await catalog.get_topic(services.db, services.settings, topic_id)


@router.get(
    "/content/manifest", response_model=ManifestResponse, summary="Current content manifest pointer"
)
async def manifest(
    services: Services,
    response: Response,
    exam: Annotated[str, Query(min_length=1, max_length=64, description="Exam profile id")],
    locale: Annotated[Literal["en", "hi"], Query()] = "en",
) -> ManifestResponse:
    response.headers["Cache-Control"] = "public, max-age=300"
    return await catalog.get_manifest(services.db, services.settings, exam, locale)


@router.get("/content/files/{file_path:path}", include_in_schema=False)
async def content_file(file_path: str, services: Services) -> FileResponse:
    """Local mode only: serves CONTENT_LOCAL_DIR the way the CDN serves R2 in production."""
    path = catalog.resolve_local_file(services.settings, file_path)
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    immutable = not file_path.startswith("manifests/")
    return FileResponse(
        path,
        media_type=media_type,
        headers={
            "Cache-Control": "public, max-age=31536000, immutable"
            if immutable
            else "public, max-age=60"
        },
    )
