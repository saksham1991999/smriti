"""``GET /v1/config``, the catalogue and the content manifest. Catalogue rows here are
placeholders made by the test (never study content)."""

from __future__ import annotations

import dataclasses
import json
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from sqlalchemy import text

from smriti_api.core.config import Settings
from smriti_api.core.deps import AppServices
from smriti_api.main import create_app
from smriti_api.services.app_config import load_variant_files

I18N = json.dumps({"en": "Placeholder", "hi": "प्लेसहोल्डर"})


async def test_config_defaults_from_the_database(client: httpx.AsyncClient) -> None:
    r = await client.get(
        "/v1/config",
        headers={"X-App-Variant": "jee", "X-Platform": "android", "X-App-Version": "0.0.9"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["variant"]["id"] == "jee"
    assert body["variant"]["exam_profile_ids"] == ["jee-main-2027", "jee-advanced-2027"]
    assert body["app_version"]["update_required"] is True
    assert body["flags"]["streak.reviews_to_qualify"] == 10
    assert body["free_limits"]["tutor_messages_per_day"] == 5
    assert {p["platform"] for p in body["pricing"]} == {"android"}
    assert all(p["price_paise"] > 0 for p in body["pricing"])
    assert r.headers["cache-control"].startswith("public")


async def test_unknown_variant_falls_back_to_all(client: httpx.AsyncClient) -> None:
    body = (await client.get("/v1/config", params={"variant": "made-up"})).json()
    assert body["variant"]["id"] == "all"


async def test_variant_files_win_when_present(tmp_path: Path, services: AppServices) -> None:
    (tmp_path / "jee.json").write_text(
        json.dumps(
            {
                "id": "jee",
                "appName": {"en": "Smriti JEE", "hi": "Smriti JEE"},
                "examIds": ["jee-main"],
                "examProfileIds": ["jee-main-2027"],
                "showExamSwitcher": False,
                "googleIosClientId": "never-exposed",
            }
        )
    )
    settings = Settings(variants_dir=str(tmp_path))
    load_variant_files.cache_clear()
    app = create_app(settings, dataclasses.replace(services, settings=settings))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        body = (
            await c.get("/v1/config", params={"variant": "jee"}, headers={"X-App-Version": "9.9.9"})
        ).json()
    assert body["variant"]["source"] == "packages/config"
    assert body["variant"]["show_exam_switcher"] is False
    assert "googleIosClientId" not in json.dumps(body)
    load_variant_files.cache_clear()


@pytest.fixture
async def catalogue(services: AppServices) -> AsyncIterator[None]:
    stmts: list[tuple[str, dict[str, str]]] = [
        (
            "insert into content.subjects (id, name, color_token, sort) values ('test-subj', cast(:n as jsonb), 'subject.physics', 99) on conflict do nothing",
            {},
        ),
        (
            "insert into content.units (id, subject_id, name, sort) values ('test-unit', 'test-subj', cast(:n as jsonb), 1) on conflict do nothing",
            {},
        ),
        (
            "insert into content.chapters (id, unit_id, subject_id, name, sort) values ('test-ch', 'test-unit', 'test-subj', cast(:n as jsonb), 1) on conflict do nothing",
            {},
        ),
        (
            "insert into content.topics (id, chapter_id, name, sort) values ('test-topic', 'test-ch', cast(:n as jsonb), 1) on conflict do nothing",
            {},
        ),
        (
            "insert into content.subtopics (id, topic_id, name, sort) values ('test-sub', 'test-topic', cast(:n as jsonb), 1) on conflict do nothing",
            {},
        ),
        (
            "insert into content.concepts (id, subtopic_id, name, summary, kind, intrinsic_depth, sort)"
            " values ('test-concept', 'test-sub', cast(:n as jsonb), cast(:n as jsonb), 'fact', 1, 1) on conflict do nothing",
            {},
        ),
        (
            "insert into content.exam_concepts (exam_profile_id, concept_id, depth) values ('jee-main-2027', 'test-concept', 1) on conflict do nothing",
            {},
        ),
        (
            "insert into content.bundles (id, topic_id, mode, locale, hash, size_bytes, card_count, min_app_version)"
            " values ('test-topic.deep_dive.en', 'test-topic', 'deep_dive', 'en', 'abc123', 100, 4, '0.1.0') on conflict do nothing",
            {},
        ),
        (
            "insert into content.manifests (exam_profile_id, locale, version, hash, is_current)"
            " values ('jee-main-2027', 'en', 1, 'm1', true) on conflict do nothing",
            {},
        ),
    ]
    async with services.db.admin_tx() as session:
        for sql, params in stmts:
            await session.execute(text(sql), {"n": I18N, **params})
    yield


async def test_catalogue(client: httpx.AsyncClient, catalogue: None) -> None:
    exams = (await client.get("/v1/catalog/exams")).json()
    jee = next(e for e in exams if e["id"] == "jee-main")
    assert jee["profiles"][0]["id"] == "jee-main-2027"
    assert set(jee["name"]) == {"en", "hi"}

    subjects = (await client.get("/v1/catalog/subjects", params={"exam": "jee-main-2027"})).json()
    assert [s["id"] for s in subjects] == ["test-subj"]
    assert subjects[0]["chapter_count"] == 1
    assert (await client.get("/v1/catalog/subjects", params={"exam": "neet-ug-2027"})).json() == []
    assert (await client.get("/v1/catalog/subjects", params={"exam": "nope"})).status_code == 404

    chapter = (await client.get("/v1/catalog/chapters/test-ch")).json()
    assert [t["id"] for t in chapter["topics"]] == ["test-topic"]
    assert chapter["is_free"] is False

    topic = (await client.get("/v1/catalog/topics/test-topic")).json()
    assert topic["subject_id"] == "test-subj"
    assert topic["bundles"][0]["hash"] == "abc123"
    missing = await client.get("/v1/catalog/topics/none")
    assert missing.status_code == 404
    assert missing.json()["code"] == "topic_not_found"


async def test_manifest(client: httpx.AsyncClient, catalogue: None) -> None:
    body = (
        await client.get("/v1/content/manifest", params={"exam": "jee-main-2027", "locale": "en"})
    ).json()
    assert body["version"] == 1
    assert body["hash"] == "m1"
    r = await client.get("/v1/content/manifest", params={"exam": "jee-main-2027", "locale": "hi"})
    assert r.status_code == 404
    assert r.json()["code"] == "manifest_not_published"


async def test_local_content_files(tmp_path: Path, services: AppServices) -> None:
    (tmp_path / "bundles").mkdir()
    (tmp_path / "bundles" / "abc.json").write_text('{"cards": []}')
    (tmp_path / "manifests" / "neet-ug-2027").mkdir(parents=True)
    (tmp_path / "manifests" / "neet-ug-2027" / "en.json").write_text(
        '{"version": 3, "hash": "h3", "bundles": []}'
    )
    (tmp_path.parent / "secret.txt").write_text("no")
    settings = Settings(content_local_dir=str(tmp_path), api_public_url="http://t")
    app = create_app(settings, dataclasses.replace(services, settings=settings))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/v1/content/files/bundles/abc.json")
        assert r.status_code == 200
        assert r.json() == {"cards": []}
        assert "immutable" in r.headers["cache-control"]
        assert (await c.get("/v1/content/files/../secret.txt")).status_code == 404
        assert (
            await c.get("/v1/content/files/bundles/%2e%2e/%2e%2e/secret.txt")
        ).status_code == 404
        m = (await c.get("/v1/content/manifest", params={"exam": "neet-ug-2027"})).json()
        assert m["manifest"]["hash"] == "h3"
        assert m["version"] == 3
        assert m["base_url"] == "http://t/v1/content/files"


async def test_problem_details_shape(client: httpx.AsyncClient) -> None:
    r = await client.get("/v1/me")
    body = r.json()
    assert r.status_code == 401
    assert set(body) >= {"type", "title", "status", "code"}
    assert r.headers["content-type"].startswith("application/problem+json")
    r = await client.get("/v1/nowhere")
    assert r.status_code == 404
    assert r.json()["code"] == "not_found"


async def test_dev_auth_is_not_mounted_outside_local(services: AppServices) -> None:
    app = create_app(Settings(app_env="production", dev_jwt_secret=""), services)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        assert (await c.post("/v1/dev/auth/anonymous")).status_code == 404
