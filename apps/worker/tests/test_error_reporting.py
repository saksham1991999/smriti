"""Sentry in the worker: a failing job is reported, without its arguments (TRD §13)."""

from __future__ import annotations

import json
import os
import uuid
from collections.abc import Iterator
from typing import Any

import arq.worker
import pytest
import sentry_sdk
from arq import create_pool
from arq.connections import RedisSettings
from sentry_sdk.envelope import Envelope
from sentry_sdk.transport import Transport
from smriti_api.core import error_reporting
from smriti_api.core.error_reporting import sentry_options

from smriti_worker import __main__ as entry

EMAIL = "parent@example.com"


class Recorder(Transport):
    def __init__(self, options: dict[str, Any] | None = None) -> None:
        super().__init__(options)
        self.events: list[dict[str, Any]] = []

    def capture_envelope(self, envelope: Envelope) -> None:
        for item in envelope.items:
            if item.type == "event" and item.payload.json is not None:
                self.events.append(item.payload.json)


@pytest.fixture
def recorder() -> Iterator[Recorder]:
    rec = Recorder()
    opts = sentry_options(
        dsn="https://public@sentry.invalid/1",
        environment="test",
        release="r1",
        service="smriti-worker",
    )
    sentry_sdk.init(**opts, transport=rec)
    try:
        yield rec
    finally:
        sentry_sdk.get_client().close()
        sentry_sdk.init(dsn=None)


async def failing_job(_ctx: dict[str, Any], email: str, user_id: str) -> None:
    raise RuntimeError("job failed")


async def test_failing_job_is_reported_without_arguments(recorder: Recorder) -> None:
    queue = f"test-sentry-{uuid.uuid4().hex[:8]}"
    redis_settings = RedisSettings.from_dsn(os.environ["REDIS_URL"])
    pool = await create_pool(redis_settings)
    try:
        await pool.enqueue_job("failing_job", EMAIL, str(uuid.uuid4()), _queue_name=queue)
        # The module attribute, as the entry point uses it, so the Sentry patch applies.
        worker = arq.worker.create_worker(
            {"functions": [failing_job], "redis_settings": redis_settings, "queue_name": queue},
            burst=True,
            handle_signals=False,
            max_tries=1,
        )
        await worker.main()
        await worker.close()
    finally:
        await pool.aclose()
    sentry_sdk.flush()
    assert recorder.events, "the job error was not reported"
    raw = json.dumps(recorder.events)
    assert EMAIL not in raw
    event = recorder.events[0]
    assert event["exception"]["values"][-1]["type"] == "RuntimeError"
    # Sentry's arq integration ran (it adds the job) and withheld the arguments.
    assert event["extra"]["arq-job"]["task"] == "failing_job"
    assert event["extra"]["arq-job"]["args"] == "[Filtered]"


def test_start_error_reporting_is_off_without_dsn(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    monkeypatch.setattr(error_reporting, "_configured", False)
    assert entry.start_error_reporting() is False
