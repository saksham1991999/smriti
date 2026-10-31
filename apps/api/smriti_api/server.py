"""The Gunicorn worker the API image runs (TRD §5: Uvicorn workers under Gunicorn).

``gunicorn smriti_api.main:app --worker-class smriti_api.server.Worker`` (see apps/api/Dockerfile).
Gunicorn's arbiter restarts a worker that dies and kills one whose event loop stops checking in for
``--timeout`` seconds. Uvicorn's own ``--workers`` supervisor cannot see a stuck loop, because its
health ping is answered from a separate thread.
"""

from __future__ import annotations

from typing import Any, ClassVar

from uvicorn_worker import UvicornWorker


class Worker(UvicornWorker):  # type: ignore[misc]  # uvicorn_worker ships no type hints
    """Uvicorn with uvloop and httptools, proxy headers on, and no ``Server`` response header."""

    CONFIG_KWARGS: ClassVar[dict[str, Any]] = {
        **UvicornWorker.CONFIG_KWARGS,
        "server_header": False,
        "proxy_headers": True,
    }

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        # Gunicorn sends SIGKILL once --graceful-timeout runs out. Stop waiting on open connections
        # a little earlier so the app's lifespan shutdown (pools, telemetry flush) still runs.
        self.config.timeout_graceful_shutdown = max(int(self.cfg.graceful_timeout) - 2, 1)
