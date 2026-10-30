"""Catalogue reads (TRD §5.1 "Catalogue", §7.2). Public content, read as ``anon`` under RLS.

Bundle and manifest URLs are built from the content base URL (the CDN, or this API's
``/v1/content/files`` in local mode) and the path templates in settings.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sqlalchemy import text

from smriti_api.core.config import Settings
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.schemas.api import (
    BundleRef,
    ChapterOut,
    ExamOut,
    ExamProfileOut,
    ManifestResponse,
    SubjectOut,
    SubtopicOut,
    TopicBrief,
    TopicOut,
)
from smriti_api.services import flags as flag_service


def _url(settings: Settings, template: str, **values: str) -> str | None:
    base = settings.content_base_url
    if not base:
        return None
    return f"{base}/{template.format(**values)}"


def _i18n(value: Any) -> dict[str, str]:
    return {str(k): str(v) for k, v in dict(value).items()} if value else {}


async def list_exams(db: Database) -> list[ExamOut]:
    async with db.anon_tx() as session:
        exams = (
            await session.execute(
                text(
                    "select id, name, category, conducting_body, official_url, is_active from content.exams order by id"
                )
            )
        ).all()
        profiles = (
            await session.execute(
                text(
                    "select id, exam_id, cycle, name, locales, schedule, is_active"
                    " from content.exam_profiles order by exam_id, cycle"
                )
            )
        ).all()
    by_exam: dict[str, list[ExamProfileOut]] = {}
    for p in profiles:
        by_exam.setdefault(p.exam_id, []).append(
            ExamProfileOut(
                id=p.id,
                cycle=p.cycle,
                name=_i18n(p.name),
                locales=list(p.locales),
                schedule=p.schedule,
                is_active=p.is_active,
            )
        )
    return [
        ExamOut(
            id=e.id,
            name=_i18n(e.name),
            category=e.category,
            conducting_body=e.conducting_body,
            official_url=e.official_url,
            is_active=e.is_active,
            profiles=by_exam.get(e.id, []),
        )
        for e in exams
    ]


async def list_subjects(db: Database, exam_profile_id: str | None) -> list[SubjectOut]:
    """Subjects, optionally only those with concepts in the exam's syllabus map."""
    async with db.anon_tx() as session:
        if exam_profile_id:
            exists = (
                await session.execute(
                    text("select 1 from content.exam_profiles where id = :e"),
                    {"e": exam_profile_id},
                )
            ).first()
            if not exists:
                raise ApiError(404, "exam_not_found", "Unknown exam profile")
        rows = (
            await session.execute(
                text(
                    """
                    select s.id, s.name, s.color_token, s.sort,
                           count(distinct ch.id) filter (where ch.id is not null) as chapters
                      from content.subjects s
                      left join content.chapters ch on ch.subject_id = s.id
                       and (cast(:e as text) is null or exists (
                             select 1 from content.topics t
                               join content.subtopics st on st.topic_id = t.id
                               join content.concepts c on c.subtopic_id = st.id
                               join content.exam_concepts ec on ec.concept_id = c.id
                              where t.chapter_id = ch.id and ec.exam_profile_id = :e))
                     group by s.id, s.name, s.color_token, s.sort
                    having cast(:e as text) is null or count(ch.id) > 0
                     order by s.sort, s.id
                    """
                ),
                {"e": exam_profile_id},
            )
        ).all()
    return [
        SubjectOut(
            id=r.id,
            name=_i18n(r.name),
            color_token=r.color_token,
            sort=r.sort,
            chapter_count=int(r.chapters),
        )
        for r in rows
    ]


async def get_chapter(db: Database, chapter_id: str) -> ChapterOut:
    async with db.anon_tx() as session:
        ch = (
            await session.execute(
                text(
                    "select id, unit_id, subject_id, name, ncert_ref, sort from content.chapters where id = :c"
                ),
                {"c": chapter_id},
            )
        ).one_or_none()
        if ch is None:
            raise ApiError(404, "chapter_not_found", "Chapter not found")
        topics = (
            await session.execute(
                text(
                    "select id, name, summary, sort from content.topics where chapter_id = :c order by sort, id"
                ),
                {"c": chapter_id},
            )
        ).all()
    async with db.system_tx() as session:
        free = await flag_service.server_flags(session)
    rotating = free.get("free.rotating_chapters")
    return ChapterOut(
        id=ch.id,
        unit_id=ch.unit_id,
        subject_id=ch.subject_id,
        name=_i18n(ch.name),
        ncert_ref=ch.ncert_ref,
        sort=ch.sort,
        topics=[
            TopicBrief(id=t.id, name=_i18n(t.name), summary=_i18n(t.summary) or None, sort=t.sort)
            for t in topics
        ],
        is_free=ch.id in rotating if isinstance(rotating, list) else None,
    )


async def get_topic(db: Database, settings: Settings, topic_id: str) -> TopicOut:
    async with db.anon_tx() as session:
        t = (
            await session.execute(
                text(
                    "select t.id, t.chapter_id, ch.subject_id, t.name, t.summary, t.sort"
                    " from content.topics t join content.chapters ch on ch.id = t.chapter_id where t.id = :t"
                ),
                {"t": topic_id},
            )
        ).one_or_none()
        if t is None:
            raise ApiError(404, "topic_not_found", "Topic not found")
        subtopics = (
            await session.execute(
                text(
                    "select id, name, sort from content.subtopics where topic_id = :t order by sort, id"
                ),
                {"t": topic_id},
            )
        ).all()
        bundles = (
            await session.execute(
                text(
                    "select id, mode, locale, hash, size_bytes, card_count, min_app_version"
                    " from content.bundles where topic_id = :t order by mode, locale"
                ),
                {"t": topic_id},
            )
        ).all()
    return TopicOut(
        id=t.id,
        chapter_id=t.chapter_id,
        subject_id=t.subject_id,
        name=_i18n(t.name),
        summary=_i18n(t.summary) or None,
        sort=t.sort,
        subtopics=[SubtopicOut(id=s.id, name=_i18n(s.name), sort=s.sort) for s in subtopics],
        bundles=[
            BundleRef(
                id=b.id,
                mode=b.mode,
                locale=b.locale,
                hash=b.hash,
                size_bytes=b.size_bytes,
                card_count=b.card_count,
                min_app_version=b.min_app_version,
                url=_url(settings, settings.content_bundle_path, hash=b.hash),
            )
            for b in bundles
        ],
    )


def _local_manifest(settings: Settings, exam: str, locale: str) -> dict[str, Any] | None:
    if not (settings.is_dev and settings.content_local_dir):
        return None
    root = Path(settings.content_local_dir).resolve()
    path = (root / settings.content_manifest_path.format(exam=exam, locale=locale)).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


async def get_manifest(
    db: Database, settings: Settings, exam: str, locale: str
) -> ManifestResponse:
    async with db.anon_tx() as session:
        profile = (
            await session.execute(
                text("select id from content.exam_profiles where id = :e"), {"e": exam}
            )
        ).first()
        if profile is None:
            raise ApiError(404, "exam_not_found", "Unknown exam profile")
        current = (
            await session.execute(
                text(
                    "select version, hash from content.manifests"
                    " where exam_profile_id = :e and locale = :l and is_current"
                ),
                {"e": exam, "l": locale},
            )
        ).one_or_none()
    async with db.system_tx() as session:
        flags = await flag_service.server_flags(session)
    rotating = flags.get("free.rotating_chapters")
    local = _local_manifest(settings, exam, locale)
    if current is None and local is None:
        raise ApiError(
            404, "manifest_not_published", "No content is published for this exam and language yet"
        )
    base = settings.content_base_url
    return ManifestResponse(
        exam_profile_id=exam,
        locale="hi" if locale == "hi" else "en",
        version=int(current.version)
        if current
        else (int(local["version"]) if local and isinstance(local.get("version"), int) else None),
        hash=current.hash
        if current
        else (str(local["hash"]) if local and local.get("hash") else None),
        url=_url(settings, settings.content_manifest_path, exam=exam, locale=locale),
        base_url=base,
        bundle_url_template=f"{base}/{settings.content_bundle_path}"
        if base
        else settings.content_bundle_path,
        patch_url_template=f"{base}/{settings.content_patch_path}"
        if base
        else settings.content_patch_path,
        free_rotating_chapters=[str(c) for c in rotating] if isinstance(rotating, list) else [],
        manifest=local,
    )


def resolve_local_file(settings: Settings, rel_path: str) -> Path:
    """A file under CONTENT_LOCAL_DIR, local/test only, with path traversal refused."""
    if not (settings.is_dev and settings.content_local_dir):
        raise ApiError(404, "not_found", "Not found")
    root = Path(settings.content_local_dir).resolve()
    if "\x00" in rel_path or rel_path.startswith("/"):
        raise ApiError(404, "not_found", "Not found")
    path = (root / rel_path).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ApiError(404, "not_found", "Not found")
    return path
