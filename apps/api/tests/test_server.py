"""The Gunicorn worker class the API image starts (apps/api/Dockerfile CMD)."""

from __future__ import annotations

import os

from gunicorn.config import Config
from gunicorn.glogging import Logger

from smriti_api.server import Worker


def _worker(*args: str) -> Worker:
    cfg = Config()
    parser = cfg.parser()
    for key, value in vars(parser.parse_args(list(args))).items():
        if value is not None and key in cfg.settings:
            cfg.set(key, value)
    return Worker(0, os.getpid(), [], None, cfg.timeout, cfg, Logger(cfg))


def test_worker_matches_the_image_flags() -> None:
    w = _worker(
        "--forwarded-allow-ips=*",
        "--keep-alive",
        "5",
        "--timeout",
        "30",
        "--graceful-timeout",
        "20",
    )
    assert w.config.server_header is False
    assert w.config.proxy_headers is True
    assert w.config.forwarded_allow_ips == ["*"]
    assert w.config.timeout_keep_alive == 5
    assert w.config.timeout_notify == 30
    # Uvicorn stops waiting on connections before Gunicorn's SIGKILL at --graceful-timeout.
    assert w.config.timeout_graceful_shutdown == 18
