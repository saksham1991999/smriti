"""``python -m smriti_worker [queue]``: run the worker for one queue (default: ``default``)."""

from __future__ import annotations

import logging.config
import os
import sys

from arq.logs import default_log_config
from arq.worker import run_worker

from smriti_worker.main import WORKERS


def main(argv: list[str]) -> int:
    queue = argv[1] if len(argv) > 1 else os.environ.get("WORKER_QUEUE", "default")
    settings = WORKERS.get(queue)
    if settings is None:
        print(f"unknown queue {queue!r}; one of: {', '.join(WORKERS)}", file=sys.stderr)
        return 2
    logging.config.dictConfig(default_log_config(verbose=False))
    run_worker(settings)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
