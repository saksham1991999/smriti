"""The shared logger scrubs personal data and secrets from rendered exceptions and messages
(AGENTS rules 5 and 6): emails, phone numbers, tokens and keys never reach a log line."""

from __future__ import annotations

import json
import uuid

import pytest
import structlog

from smriti_api.core.logging import configure_logging, scrub_text

JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlLXZhbHVl"


@pytest.mark.parametrize(
    ("raw", "gone"),
    [
        ("lookup failed for asha.verma@example.com", "asha.verma@example.com"),
        ("call 98765 43210 now", "98765 43210"),
        ("user +91-9876543210 not found", "9876543210"),
        ("intl +44 20 7946 0958", "7946 0958"),
        (f"Authorization: Bearer {JWT}", JWT),
        (f"bad token {JWT}", JWT),
        ("POST https://api.example.com/x?api_key=sk_live_abc123&x=1", "sk_live_abc123"),
        ("password='hunter2-secret'", "hunter2-secret"),
        ("postgresql://postgres:s3cr3t@db:5432/app", "s3cr3t"),
        (
            "key rzp_live_9aB3xQ7mN2pL5kR8tV1wY4zC6dF0gH2jK",
            "rzp_live_9aB3xQ7mN2pL5kR8tV1wY4zC6dF0gH2jK",
        ),
    ],
)
def test_scrub_text_removes_personal_data_and_secrets(raw: str, gone: str) -> None:
    assert gone not in scrub_text(raw)


def test_scrub_text_keeps_ids_times_and_digests() -> None:
    uid = str(uuid.uuid4())
    digest = "a" * 24 + "0123456789abcdef" * 3
    line = f"user {uid} at 2026-10-31 05:31:06 hash {digest} line 412 took 1730352666000 ms"
    assert scrub_text(line) == line


def test_logged_exceptions_are_scrubbed(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("INFO")
    structlog.reset_defaults()
    configure_logging("INFO")
    log = structlog.get_logger("test")
    try:
        raise ValueError(f"no account for riya@example.com (98765 43210), token={JWT}")
    except ValueError:
        log.exception("lookup_failed", note_count=1)
    out = capsys.readouterr().out.strip().splitlines()[-1]
    line = json.loads(out)
    assert "ValueError" in line["exception"]
    for secret in ("riya@example.com", "98765 43210", JWT):
        assert secret not in out
    assert "[email]" in line["exception"] and "[phone]" in line["exception"]
