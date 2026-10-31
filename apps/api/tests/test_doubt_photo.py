"""Photo doubt (tutor-social §A10, AI-16 to AI-19; R58) with the fake provider: gates, upload to
storage, the vision read, rejection and deletion of personal photos, solving as a tutor chat with
hints first, quota, no image or text in logs, and retention."""

from __future__ import annotations

import json
import uuid
from typing import Any

import httpx
import structlog
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.integrations.storage import LocalStorage
from smriti_api.services import doubt_photo
from tests.helpers import Session
from tests.money_helpers import set_profile
from tests.practice_helpers import flags, learner, make_pro
from tests.test_tutor import events, fake_llm, named

# A tiny JPEG-shaped body: the server checks the magic bytes, the fake model never decodes it.
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
READ_OK = json.dumps({"status": "ok", "question": "Find $x$ if $2x + 3 = 7$.", "subject": "Maths"})


async def adult_pro(client: httpx.AsyncClient, services: AppServices, content: str) -> Session:
    s = await learner(client, content)
    await set_profile(services, s.user_id, age_band="18p")
    await make_pro(services, s)
    return s


async def upload(client: httpx.AsyncClient, s: Session, body: bytes = JPEG) -> httpx.Response:
    return await client.post(
        "/v1/ai/doubt-photos",
        content=body,
        headers={**s.headers, "Content-Type": "image/jpeg"},
    )


async def photo_row(services: AppServices, photo_id: str) -> Any:
    async with services.db.admin_tx() as session:
        return (
            await session.execute(
                text("select * from ai.doubt_photos where id = :id"), {"id": photo_id}
            )
        ).one()


def storage(services: AppServices) -> LocalStorage:
    assert services.integrations is not None
    store = services.integrations.storage
    assert isinstance(store, LocalStorage)
    return store


async def test_gates(client: httpx.AsyncClient, services: AppServices, content: str) -> None:
    free = await learner(client, content)
    await set_profile(services, free.user_id, age_band="18p")
    r = await upload(client, free)
    assert r.status_code == 403 and r.json()["code"] == "pro_required"

    child = await learner(client, content)
    await set_profile(services, child.user_id, age_band="10_12")
    await make_pro(services, child)
    r = await upload(client, child)
    assert r.status_code == 403 and r.json()["code"] == "photo_doubt_not_for_age"

    # A teen needs the guardian's uploads scope.
    teen = await learner(client, content)
    await set_profile(services, teen.user_id, age_band="13_17")
    await make_pro(services, teen)
    r = await upload(client, teen)
    assert r.status_code == 403 and r.json()["code"] == "guardian_consent_required"
    assert r.json()["scope"] == "uploads"

    adult = await adult_pro(client, services, content)
    r = await upload(client, adult, b"not an image at all")
    assert r.status_code == 415
    r = await upload(client, adult, b"\xff\xd8\xff" + b"\x00" * doubt_photo.MAX_PHOTO_BYTES)
    assert r.status_code == 413


async def test_read_then_solve_hints_first(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    s = await adult_pro(client, services, content)
    with structlog.testing.capture_logs() as logs, fake_llm(services, [READ_OK]) as fake:
        r = await upload(client, s)
        assert r.status_code == 201, r.text
        tier, messages = fake.calls[0]
    photo = r.json()
    assert (photo["status"], photo["reason"], photo["subject"]) == ("read", None, "maths")
    assert photo["question_text"] == "Find $x$ if $2x + 3 = 7$."
    # The vision tier got the image as a data URI; nothing of it, or of the text, was logged.
    assert tier == "vision"
    parts = messages[1].content
    assert isinstance(parts, list) and parts[1]["image_url"]["url"].startswith("data:image/jpeg")
    flat = json.dumps(logs, default=str)
    assert "2x + 3" not in flat and "base64" not in flat
    row = await photo_row(services, photo["id"])
    assert storage(services).path("uploads", row.storage_key).read_bytes() == JPEG
    assert str(s.user_id) not in row.storage_key

    # Solve: a tutor chat on the photo, hints first, counted like any tutor message.
    with fake_llm(services) as fake:
        r = await client.post(
            f"/v1/ai/doubt-photos/{photo['id']}/solve",
            json={
                "client_message_id": str(uuid.uuid4()),
                "text": "Find x if 2x + 3 = 7.",
                "question_text": "Find $x$ if $2x + 3 = 7$, and show the steps.",
            },
            headers=s.headers,
        )
        assert r.status_code == 200, r.text
        system = str(fake.calls[0][1][0].content)
    evs = events(r.text)
    session_id = named(evs, "session")[0]["session_id"]
    assert "Give one hint only" in system and "show the steps" in system
    assert named(evs, "chips")[0]["items"][0] == "show_full_solution"
    assert named(evs, "quota")[0]["used"] == 1
    assert named(evs, "done")[0]["status"] == "ok"
    sess = (await client.get(f"/v1/tutor/sessions/{session_id}", headers=s.headers)).json()
    assert sess["mode"] == "doubt_photo" and sess["context"]["kind"] == "doubt"
    got = (await client.get(f"/v1/ai/doubt-photos/{photo['id']}", headers=s.headers)).json()
    assert got["status"] == "solved" and got["session_id"] == session_id

    # "Show full solution": the same chat, no longer hints only.
    with fake_llm(services) as fake:
        r = await client.post(
            f"/v1/ai/doubt-photos/{photo['id']}/solve",
            json={"client_message_id": str(uuid.uuid4()), "text": "Show me", "reveal": True},
            headers=s.headers,
        )
        system = str(fake.calls[0][1][0].content)
    evs = events(r.text)
    assert named(evs, "session")[0] == {"session_id": session_id, "resumed": True}
    assert "Give one hint only" not in system

    # Someone else can't see or solve it.
    other = await adult_pro(client, services, content)
    r = await client.get(f"/v1/ai/doubt-photos/{photo['id']}", headers=other.headers)
    assert r.status_code == 404


async def test_bad_reads_and_personal_photos(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    s = await adult_pro(client, services, content)
    replies = [json.dumps({"status": "multiple"}), json.dumps({"status": "personal"}), "garbled"]
    with fake_llm(services, replies):
        multiple = (await upload(client, s)).json()
        personal = (await upload(client, s)).json()
        garbled = (await upload(client, s)).json()
    assert (multiple["status"], multiple["reason"]) == ("unreadable", "multiple")
    assert (garbled["status"], garbled["reason"]) == ("unreadable", "unreadable")
    assert (personal["status"], personal["reason"]) == ("rejected", "personal")
    # A personal photo is deleted at once; a blurry one waits for retention like the others.
    row = await photo_row(services, personal["id"])
    assert row.storage_key is None and row.deleted_at is not None
    r = await client.post(
        f"/v1/ai/doubt-photos/{multiple['id']}/solve",
        json={"client_message_id": str(uuid.uuid4()), "text": "Solve it"},
        headers=s.headers,
    )
    assert r.status_code == 409 and r.json()["code"] == "photo_not_read"


async def test_quota_and_retention(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    s = await adult_pro(client, services, content)
    with fake_llm(services, [READ_OK]):
        photo = (await upload(client, s)).json()
    key = (await photo_row(services, photo["id"])).storage_key
    async with flags(services, {"pro.tutor_messages_per_day": 0}):
        r = await upload(client, s)
        assert r.status_code == 429 and r.json()["code"] == "quota_exhausted"
    async with flags(services, {"ai.tutor_retention_days": 0}):
        assert await doubt_photo.purge_old_photos(services.db, storage(services)) >= 1
    assert not storage(services).path("uploads", key).exists()
    r = await client.get(f"/v1/ai/doubt-photos/{photo['id']}", headers=s.headers)
    assert r.status_code == 404
