"""Tutor pictures ("Draw it" and the voice board; tutor-social §A5 step 6, §A9 step 4; TRD §9.3):
the brief is screened like tutor text, an exact cache hit is reused across students, new Agnes
images are Pro only, never for under-13s and capped, files are private behind short-lived signed
links, a failure is retried once, and rows follow the tutor's retention."""

from __future__ import annotations

import base64
import json
import uuid
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from urllib.parse import urlsplit

import httpx
import pytest
from sqlalchemy import text

from smriti_api.ai.interfaces import AIError, GeneratedImage, ImageResult
from smriti_api.core.deps import AppServices
from smriti_api.services import tutor_images
from smriti_api.services.jobs import InlineJobQueue
from tests.helpers import Session
from tests.money_helpers import grant_pro, set_profile
from tests.practice_helpers import flags, learner
from tests.test_tutor import events, fake_llm, named
from tests.test_voice import VOICE_ON, adult, fake_voice, start

PNG = b"\x89PNG\r\n\x1a\n" + b"fake-test-image"


class FakePngImageProvider:
    """A test stand-in for the image tier: fixed bytes with a PNG signature (not a picture)."""

    name = "fake"

    def __init__(self, fail: int = 0) -> None:
        self.prompts: list[str] = []
        self.fail = fail

    async def generate(
        self,
        prompt: str,
        *,
        size: str = "1K",
        ratio: str = "1:1",
        seed: int | None = None,
        reference_images: Sequence[str] | None = None,
        response_format: Literal["url", "b64_json"] = "url",
    ) -> ImageResult:
        self.prompts.append(prompt)
        if self.fail:
            self.fail -= 1
            raise AIError("fake image failure")
        return ImageResult(
            images=[GeneratedImage(b64_json=base64.b64encode(PNG).decode())], model="fake-image"
        )


@contextmanager
def fake_images(services: AppServices, fail: int = 0) -> Iterator[FakePngImageProvider]:
    old = services.ai.image
    fake = FakePngImageProvider(fail)
    services.ai.image = fake
    try:
        yield fake
    finally:
        services.ai.image = old


async def drain(services: AppServices) -> None:
    if isinstance(services.jobs, InlineJobQueue):
        await services.jobs.drain()


def brief(words: str = "a plant cell with its parts") -> tuple[str, str]:
    """A unique brief (the cache is shared across tests) and the cheap tier's JSON for it."""
    b = f"{words} {uuid.uuid4().hex[:8]}"
    return b, json.dumps({"brief": b, "alt": "A plant cell.", "style": "diagram"})


async def draw(
    client: httpx.AsyncClient, services: AppServices, s: Session, reply: str
) -> list[tuple[str, dict[str, Any]]]:
    r = await client.post("/v1/tutor/sessions", json={"context_ref": None}, headers=s.headers)
    assert r.status_code == 200, r.text
    with fake_llm(services, ["Here is how a plant cell looks.", reply]):
        r = await client.post(
            f"/v1/tutor/sessions/{r.json()['id']}/messages",
            json={
                "client_message_id": str(uuid.uuid4()),
                "text": "Draw it, I'm Riya from Pune",
                "input": "chip",
                "chip_id": "draw_it",
            },
            headers=s.headers,
        )
    assert r.status_code == 200, r.text
    return events(r.text)


async def pro_adult(client: httpx.AsyncClient, services: AppServices, content: str) -> Session:
    s = await learner(client, content)
    await set_profile(services, s.user_id, age_band="18p")
    await grant_pro(services, s.user_id)
    return s


async def rows(services: AppServices, user_id: uuid.UUID) -> list[Any]:
    async with services.db.admin_tx() as session:
        return list(
            (
                await session.execute(
                    text("select * from ai.tutor_images where user_id = :u order by created_at"),
                    {"u": user_id},
                )
            ).all()
        )


async def test_draw_it_generates_privately_and_is_reused_across_students(
    client: httpx.AsyncClient,
    services: AppServices,
    content: str,
    capsys: pytest.CaptureFixture[str],
) -> None:
    s = await pro_adult(client, services, content)
    b, reply = brief()
    with fake_images(services) as fake:
        evs = await draw(client, services, s, reply)
        pending = named(evs, "image_pending")[0]
        assert pending["alt"] == "A plant cell."
        assert [e for e, _ in evs].index("image_pending") < [e for e, _ in evs].index("done")
        await drain(services)
    # The preset prompt, from the brief only: never the student's message.
    assert len(fake.prompts) == 1 and b in fake.prompts[0]
    assert "Riya" not in fake.prompts[0] and "no text" in fake.prompts[0]

    gid = pending["generation_id"]
    r = await client.get(f"/v1/ai/generations/{gid}", headers=s.headers)
    assert r.status_code == 200, r.text
    out = r.json()
    assert (out["status"], out["origin"], out["source"]) == ("ready", "generated", "tutor_chat")
    assert out["can_retry"] is False and "prompt" not in out
    assert datetime.fromisoformat(out["url_expires_at"]) <= datetime.now(UTC) + timedelta(
        seconds=tutor_images.URL_TTL_S + 5
    )
    # A private file behind a signed link.
    link = urlsplit(out["url"])
    assert "/uploads/tutor-images/" in link.path
    file = await client.get(f"{link.path}?{link.query}")
    assert file.status_code == 200 and file.content == PNG
    assert (await client.get(link.path)).status_code in (401, 403, 422)

    # The answer carries the picture in history.
    sess = (
        await client.get(f"/v1/tutor/sessions/{out['tutor_session_id']}", headers=s.headers)
    ).json()
    answer = next(m for m in sess["messages"] if m["id"] == out["message_id"])
    assert answer["images"] == [{"generation_id": gid, "status": "ready", "alt": "A plant cell."}]

    # Someone else's picture is not found.
    other = await pro_adult(client, services, content)
    assert (await client.get(f"/v1/ai/generations/{gid}", headers=other.headers)).status_code == 404

    # A free student asking for the same picture gets the cached file at once (Q-A2).
    free = await learner(client, content)
    with fake_images(services) as fake:
        evs = await draw(client, services, free, reply)
    ready = named(evs, "image_ready")[0]
    assert ready["url"] and fake.prompts == []
    assert (await rows(services, free.user_id))[0].origin == "cache"

    # An under-13 sees reviewed index images only, never another student's generated one, and
    # never a new one (no price either: not_for_age, R15).
    child = await learner(client, content)
    await set_profile(services, child.user_id, age_band="10_12")
    await grant_pro(services, child.user_id)
    with fake_images(services) as fake:
        evs = await draw(client, services, child, reply)
    assert named(evs, "image_failed") == [
        {"generation_id": None, "reason": "not_for_age", "retry": False}
    ]
    assert fake.prompts == [] and await rows(services, child.user_id) == []

    # No brief, prompt or alt text in the logs.
    logged = capsys.readouterr()
    assert b not in logged.out + logged.err


async def test_free_miss_blocked_brief_and_caps(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    free = await learner(client, content)
    _, reply = brief()
    with fake_images(services) as fake:
        evs = await draw(client, services, free, reply)
    assert named(evs, "image_failed")[0]["reason"] == "pro_required"
    assert fake.prompts == [] and await rows(services, free.user_id) == []

    s = await pro_adult(client, services, content)
    bad = json.dumps({"brief": "how to make a bomb at home", "alt": "x", "style": "scene"})
    with fake_images(services) as fake:
        evs = await draw(client, services, s, bad)
    failed = named(evs, "image_failed")[0]
    assert (failed["reason"], failed["retry"]) == ("policy", False)
    assert fake.prompts == []
    async with services.db.admin_tx() as session:
        flagged = (
            await session.execute(
                text(
                    "select category from ai.moderation_flags where source_kind = 'tutor_image'"
                    " and source_id = :g"
                ),
                {"g": failed["generation_id"]},
            )
        ).scalar_one()
    assert flagged == "weapons"
    assert (await rows(services, s.user_id))[0].status == "blocked"

    # Hourly and daily caps apply even for Pro.
    async with flags(services, {"pro.tutor_images_per_hour": 1, "pro.tutor_images_per_day": 5}):
        with fake_images(services):
            first = await draw(client, services, s, brief()[1])
            second = await draw(client, services, s, brief()[1])
            await drain(services)
    assert named(first, "image_pending")
    assert named(second, "image_failed")[0]["reason"] == "limit_reached"

    # A brief the cheap tier could not write: no picture, no row.
    with fake_images(services):
        evs = await draw(client, services, s, "not json")
    assert named(evs, "image_failed")[0] == {
        "generation_id": None,
        "reason": "failed",
        "retry": False,
    }


async def test_a_failed_picture_is_retried_once(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    s = await pro_adult(client, services, content)
    with fake_images(services, fail=2) as fake:
        evs = await draw(client, services, s, brief()[1])
        gid = named(evs, "image_pending")[0]["generation_id"]
        await drain(services)
        out = (await client.get(f"/v1/ai/generations/{gid}", headers=s.headers)).json()
        assert (out["status"], out["reason"], out["can_retry"]) == ("failed", "failed", True)
        assert out["url"] is None

        r = await client.post(f"/v1/ai/generations/{gid}/retry", headers=s.headers)
        assert r.status_code == 200 and r.json()["status"] == "pending"
        await drain(services)
        out = (await client.get(f"/v1/ai/generations/{gid}", headers=s.headers)).json()
        assert (out["status"], out["can_retry"]) == ("failed", False)
        r = await client.post(f"/v1/ai/generations/{gid}/retry", headers=s.headers)
        assert r.status_code == 409 and r.json()["code"] == "cannot_retry"
        assert len(fake.prompts) == 2

    # The retry that works lands the picture; a ready picture can't be retried.
    with fake_images(services, fail=1):
        evs = await draw(client, services, s, brief()[1])
        gid = named(evs, "image_pending")[0]["generation_id"]
        await drain(services)
        await client.post(f"/v1/ai/generations/{gid}/retry", headers=s.headers)
        await drain(services)
    out = (await client.get(f"/v1/ai/generations/{gid}", headers=s.headers)).json()
    assert out["status"] == "ready" and out["url"]
    r = await client.post(f"/v1/ai/generations/{gid}/retry", headers=s.headers)
    assert r.status_code == 409


async def test_voice_board_pictures(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    s = await adult(client, services)
    with fake_voice(services), fake_images(services) as fake:
        async with flags(services, VOICE_ON):
            sess = (await start(client, s)).json()
            assert "generate_image" in {t["name"] for t in sess["tools"]}
            b = f"the water cycle {uuid.uuid4().hex[:8]}"
            r = await client.post(
                f"/v1/voice/sessions/{sess['id']}/tools",
                json={
                    "call_id": "img1",
                    "name": "generate_image",
                    "args": {"brief": b, "alt": "The water cycle.", "style": "scene"},
                },
                headers=s.headers,
            )
            assert r.status_code == 200, r.text
            board = r.json()["result"]["board"]
            assert (board["kind"], board["status"]) == ("image", "pending")
            await drain(services)
            missing = await client.post(
                f"/v1/voice/sessions/{sess['id']}/tools",
                json={"call_id": "img2", "name": "generate_image", "args": {"brief": b}},
                headers=s.headers,
            )
            assert missing.json()["result"] == {"error": "failed"}
    assert len(fake.prompts) == 1 and "a simple scene showing" in fake.prompts[0]
    out = (
        await client.get(f"/v1/ai/generations/{board['generation_id']}", headers=s.headers)
    ).json()
    assert (out["status"], out["source"]) == ("ready", "voice_board")


async def test_pictures_follow_tutor_retention(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    assert services.integrations is not None
    storage = services.integrations.storage
    s = await pro_adult(client, services, content)
    with fake_images(services):
        evs = await draw(client, services, s, brief()[1])
        gid = named(evs, "image_pending")[0]["generation_id"]
        await drain(services)
    old = datetime.now(UTC) - timedelta(days=400)
    async with services.db.admin_tx() as session:
        row = (
            await session.execute(
                text(
                    "update ai.tutor_images set created_at = :t where id = :g"
                    " returning prompt_hash, storage_key"
                ),
                {"g": gid, "t": old},
            )
        ).one()
        await session.execute(
            text("update ai.image_cache set last_used_at = :t where prompt_hash = :h"),
            {"h": row.prompt_hash, "t": old},
        )
    assert await storage.get("uploads", row.storage_key) == PNG
    removed = await tutor_images.purge(services.db, storage)
    assert removed >= 2
    assert await rows(services, s.user_id) == []
    async with services.db.admin_tx() as session:
        left = (
            await session.execute(
                text("select count(*) from ai.image_cache where prompt_hash = :h"),
                {"h": row.prompt_hash},
            )
        ).scalar_one()
    assert left == 0
    with pytest.raises(Exception, match="not found"):
        await storage.get("uploads", row.storage_key)


def test_preset_prompt_and_cache_key() -> None:
    prompt = tutor_images.compose("a pulley system", "diagram")
    assert prompt.startswith("Soft 3D illustration of a pulley system")
    assert "a clear educational diagram of a pulley system" in prompt
    assert prompt.endswith("extra limbs.")
    key = tutor_images.cache_key("A  pulley system", "sunny-diagram", "2K", "3:2", "m1")
    assert key == tutor_images.cache_key("a pulley system", "sunny-diagram", "2K", "3:2", "m1")
    assert key != tutor_images.cache_key("a pulley system", "sunny-diagram", "2K", "3:2", "m2")
