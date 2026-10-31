"""Deploy entry points: the multi-queue worker process and the CI content apply step."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest
from smriti_api.services import card_index

from smriti_worker import content_apply
from smriti_worker.__main__ import UnknownQueue, main, parse_queues, run_many
from smriti_worker.main import WORKERS


def test_parse_queues() -> None:
    assert parse_queues("all") == list(WORKERS)
    assert parse_queues("") == ["default"]
    assert parse_queues("pdf") == ["pdf"]
    # WORKERS order, no repeats, spaces ignored.
    assert parse_queues(" media, default ,media") == ["default", "media"]
    with pytest.raises(UnknownQueue, match="nope"):
        parse_queues("default,nope")


def test_unknown_queue_exits_2(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["smriti_worker", "default,nope"]) == 2
    assert "unknown queue nope" in capsys.readouterr().err


async def test_run_many_starts_and_stops_every_worker() -> None:
    stop = asyncio.Event()
    asyncio.get_running_loop().call_later(1.5, stop.set)
    code = await asyncio.wait_for(run_many([WORKERS["ai"], WORKERS["pdf"]], stop), timeout=30)
    assert code == 0


async def test_content_apply_guards_and_applies(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    report = tmp_path / "report"
    report.mkdir()
    root = tmp_path / "content"
    with pytest.raises(FileNotFoundError, match="metadata"):
        await content_apply.apply(report, root)
    (report / "metadata.sql").write_text("select 1;\nselect 2;\n")
    with pytest.raises(FileNotFoundError, match="no lessons"):
        await content_apply.apply(report, root)
    (root / "lessons" / "x").mkdir(parents=True)
    (root / "lessons" / "x" / "a.json").write_text("{}")

    seen: list[Path] = []

    async def fake_index(session: Any, folder: Path) -> dict[str, int]:
        seen.append(folder)
        return {"indexed": 0}

    monkeypatch.setattr(card_index, "index_lessons", fake_index)
    result = await content_apply.apply(report, root)
    assert result == {"metadata_bytes": len("select 1;\nselect 2;\n"), "card_index": {"indexed": 0}}
    assert seen == [root]

    (report / "metadata.sql").write_text("select nope_not_a_column from nowhere;")
    with pytest.raises(Exception, match="nowhere"):
        await content_apply.apply(report, root)


async def test_health_reads_each_queues_key() -> None:
    from smriti_worker import health

    # No worker is running for these queues in the test Redis.
    assert await health.check(["pdf"]) == ["pdf"]
    stop = asyncio.Event()

    async def probe() -> list[str]:
        await asyncio.sleep(1.0)
        try:
            return await health.check(["ai", "pdf"])
        finally:
            stop.set()

    probe_task = asyncio.create_task(probe())
    await asyncio.wait_for(run_many([WORKERS["ai"], WORKERS["pdf"]], stop), timeout=30)
    assert await probe_task == []
