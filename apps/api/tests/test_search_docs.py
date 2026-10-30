"""The publisher writes a search document per topic and concept in each locale (TRD §9.5), and
tutor retrieval reads them by full text while pgvector is missing."""

from __future__ import annotations

from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.services.tutor_retrieval import FullTextRetriever


async def test_retrieval_reads_the_published_search_docs(
    services: AppServices, content: str
) -> None:
    async with services.db.admin_tx() as session:
        locales = (
            await session.execute(
                text(
                    "select array_agg(locale order by locale) from content.search_docs"
                    " where ref_kind = 'topic' and ref_id = 'fx.chapter-a.topic-a'"
                )
            )
        ).scalar_one()
        assert locales == ["en", "hi"]
        concepts = (
            await session.execute(
                text("select count(*) from content.search_docs where ref_kind = 'concept'")
            )
        ).scalar_one()
        assert concepts > 0
        # "traps" is only in a card title, so it comes from the search document.
        found = await FullTextRetriever().search(
            session, "traps", exam=content, locale="en", limit=5
        )
        hindi = await FullTextRetriever().search(
            session, "शीर्षक", exam=content, locale="hi", limit=5
        )
    hit = next(p for p in found if p.id == "fx.chapter-a.topic-a")
    assert "Fixture title A traps" in hit.body
    assert len({(p.kind, p.id) for p in found}) == len(found)
    assert any("शीर्षक" in p.body for p in hindi)
