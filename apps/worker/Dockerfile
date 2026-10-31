# Smriti worker (arq) image. Build from the repository root:
#
#   docker build -f apps/worker/Dockerfile -t smriti-worker .
#
# One image serves every queue. WORKER_QUEUE picks them: "all" (one process for every queue),
# one queue name, or a comma-separated list (python -m smriti_worker). Crons run with the default
# queue. Railway builds it from infra/railway/worker.railway.json. No secrets in the image.

ARG PYTHON_IMAGE=python:3.12.12-slim-bookworm
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.11.32

FROM ${UV_IMAGE} AS uv

# --- build: resolve the locked dependencies into /app/.venv ---------------------------------------
FROM ${PYTHON_IMAGE} AS build
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app

COPY pyproject.toml uv.lock ./
COPY apps/api/pyproject.toml apps/api/pyproject.toml
COPY apps/worker/pyproject.toml apps/worker/pyproject.toml
RUN uv sync --frozen --no-dev --no-install-workspace --package smriti-worker

# The worker runs the API's services, so both packages are installed in place (see apps/api/Dockerfile).
COPY apps/api/smriti_api apps/api/smriti_api
COPY apps/worker/smriti_worker apps/worker/smriti_worker
RUN uv sync --frozen --no-dev --package smriti-worker \
 && python -m compileall -q apps/api/smriti_api apps/worker/smriti_worker

# --- runtime ------------------------------------------------------------------------------------
FROM ${PYTHON_IMAGE} AS runtime
# WeasyPrint (PDF export) needs Pango and HarfBuzz; the export templates ask for Noto Sans and
# Noto Sans Devanagari (fonts-noto-core) with DejaVu as the fallback (apps/api services/exports.py).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libharfbuzz-subset0 \
      fontconfig fonts-noto-core fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH=/app/.venv/bin:$PATH \
    WORKER_QUEUE=all
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home-dir /home/app --create-home --shell /usr/sbin/nologin app
WORKDIR /app

COPY --from=build /app /app
# Read at runtime: flag defaults, variants, server copy, and the lesson files the PDF export and
# the card index read. Content changes reach the worker with its next deploy.
COPY packages/config/flag-defaults.json packages/config/flag-defaults.json
COPY packages/config/variants packages/config/variants
COPY packages/config/brand.json packages/config/brand.json
COPY packages/i18n/src/locales packages/i18n/src/locales
COPY content content

USER app
# arq writes a health key per queue every 60 s; this reads the keys for WORKER_QUEUE.
HEALTHCHECK --interval=60s --timeout=10s --start-period=90s --retries=3 \
  CMD ["python", "-m", "smriti_worker.health"]
CMD ["python", "-m", "smriti_worker"]
