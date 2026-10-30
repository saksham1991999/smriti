"""Retrieval over published content for the tutor (TRD §9.2 ``search_content``, §9.5).

``PgVectorRetriever`` ranks ``content.search_docs`` by embedding distance when the ``vector``
extension, the ``embedding`` column and an embedder are all present. Otherwise (and in local
development, which has no pgvector) ``FullTextRetriever`` uses Postgres full-text search over
``search_docs`` and the concept and topic texts, with the ``simple`` configuration so Hindi and
English both match. Results become the tutor's grounding and the answer's citations.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_WORD = re.compile(r"[0-9A-Za-zऀ-ॿ]{3,}")


@dataclass(frozen=True)
class Passage:
    kind: str  # concept, topic, or a search_docs ref_kind
    id: str
    title: str
    body: str
    score: float

    def citation(self) -> dict[str, Any]:
        return {"kind": self.kind, "id": self.id, "title": self.title}


class Retriever(Protocol):
    name: str

    async def search(
        self, session: AsyncSession, query: str, *, exam: str | None, locale: str, limit: int
    ) -> list[Passage]: ...


class Embedder(Protocol):
    async def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


def or_query(query: str) -> str | None:
    """A ``to_tsquery`` string that matches any of the words (students ask in sentences, so an
    all-words match would rarely hit). Only letters and digits get through."""
    words = sorted({w.lower() for w in _WORD.findall(query)})[:24]
    return " | ".join(words) if words else None


def _text(value: Any, locale: str) -> str:
    if isinstance(value, dict):
        return str(value.get(locale) or value.get("en") or "")
    return str(value or "")


class FullTextRetriever:
    name = "fts"

    async def search(
        self, session: AsyncSession, query: str, *, exam: str | None, locale: str, limit: int
    ) -> list[Passage]:
        q = or_query(query)
        if q is None:
            return []
        rows = (
            await session.execute(
                text(
                    """
                    with q as (select to_tsquery('simple', :q) as tsq)
                    select 'concept' as kind, c.id, c.name as title,
                           jsonb_build_object('summary', c.summary, 'key_points', c.key_points) as body,
                           ts_rank(to_tsvector('simple',
                             coalesce(c.name ->> 'en', '') || ' ' || coalesce(c.name ->> 'hi', '') || ' ' ||
                             coalesce(c.summary ->> 'en', '') || ' ' || coalesce(c.summary ->> 'hi', '') || ' ' ||
                             coalesce(c.key_points::text, '')), q.tsq) as score
                      from content.concepts c, q
                     where to_tsvector('simple',
                             coalesce(c.name ->> 'en', '') || ' ' || coalesce(c.name ->> 'hi', '') || ' ' ||
                             coalesce(c.summary ->> 'en', '') || ' ' || coalesce(c.summary ->> 'hi', '') || ' ' ||
                             coalesce(c.key_points::text, '')) @@ q.tsq
                       and (cast(:exam as text) is null or exists (
                             select 1 from content.exam_concepts ec
                              where ec.exam_profile_id = :exam and ec.concept_id = c.id))
                    union all
                    select 'topic', t.id, t.name, jsonb_build_object('summary', t.summary),
                           ts_rank(to_tsvector('simple',
                             coalesce(t.name ->> 'en', '') || ' ' || coalesce(t.name ->> 'hi', '') || ' ' ||
                             coalesce(t.summary ->> 'en', '') || ' ' || coalesce(t.summary ->> 'hi', '')), q.tsq)
                      from content.topics t, q
                     where to_tsvector('simple',
                             coalesce(t.name ->> 'en', '') || ' ' || coalesce(t.name ->> 'hi', '') || ' ' ||
                             coalesce(t.summary ->> 'en', '') || ' ' || coalesce(t.summary ->> 'hi', '')) @@ q.tsq
                    union all
                    select d.ref_kind, d.ref_id, to_jsonb(d.title), to_jsonb(d.body), ts_rank(d.tsv, q.tsq)
                      from content.search_docs d, q
                     where d.tsv @@ q.tsq and d.locale = :locale
                       and (cast(:exam as text) is null or :exam = any(d.exam_profile_ids))
                    order by score desc, id
                    limit :n
                    """
                ),
                {"q": q, "exam": exam, "locale": locale, "n": limit},
            )
        ).all()
        out = []
        for r in rows:
            body = r.body
            if isinstance(body, dict):
                parts = [_text(body.get("summary"), locale)]
                points = body.get("key_points")
                if isinstance(points, list):
                    parts += [_text(p, locale) for p in points]
                body_text = "\n".join(p for p in parts if p)
            else:
                body_text = str(body or "")
            out.append(Passage(r.kind, r.id, _text(r.title, locale), body_text, float(r.score)))
        return out


class PgVectorRetriever:
    """Embedding search over ``content.search_docs.embedding`` (pgvector, cosine distance)."""

    name = "pgvector"

    def __init__(self, embedder: Embedder) -> None:
        self._embedder = embedder

    async def search(
        self, session: AsyncSession, query: str, *, exam: str | None, locale: str, limit: int
    ) -> list[Passage]:
        [vector] = await self._embedder.embed([query])
        rows = (
            await session.execute(
                text(
                    "select ref_kind, ref_id, title, body, 1 - (embedding <=> cast(:v as vector)) as score"
                    " from content.search_docs where embedding is not null and locale = :locale"
                    " and (cast(:exam as text) is null or :exam = any(exam_profile_ids))"
                    " order by embedding <=> cast(:v as vector) limit :n"
                ),
                {
                    "v": "[" + ",".join(f"{x:.6f}" for x in vector) + "]",
                    "exam": exam,
                    "locale": locale,
                    "n": limit,
                },
            )
        ).all()
        return [Passage(r.ref_kind, r.ref_id, r.title, r.body, float(r.score)) for r in rows]


async def has_vector_index(session: AsyncSession) -> bool:
    row = (
        await session.execute(
            text(
                "select exists (select 1 from pg_extension where extname = 'vector')"
                " and exists (select 1 from information_schema.columns where table_schema = 'content'"
                " and table_name = 'search_docs' and column_name = 'embedding')"
            )
        )
    ).scalar_one()
    return bool(row)


async def pick(session: AsyncSession, embedder: Embedder | None) -> Retriever:
    """pgvector when it is installed, populated and an embedder is configured; full text otherwise."""
    if embedder is not None and await has_vector_index(session):
        return PgVectorRetriever(embedder)
    return FullTextRetriever()
