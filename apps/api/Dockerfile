# Smriti API (FastAPI) image. Build from the repository root, since the uv workspace and the
# shared data files (flag defaults, variants, i18n catalogues, migrations) live there:
#
#   docker build -f apps/api/Dockerfile -t smriti-api .
#
# Railway builds it from infra/railway/api.railway.json. The image carries no secrets: every
# value comes from the service's environment at runtime (names in .env.example).

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

# Dependencies first (cached until the lockfile or a pyproject changes). Every workspace member's
# pyproject is needed for uv to read the lock, even the ones this image does not install.
COPY pyproject.toml uv.lock ./
COPY apps/api/pyproject.toml apps/api/pyproject.toml
COPY apps/worker/pyproject.toml apps/worker/pyproject.toml
RUN uv sync --frozen --no-dev --no-install-workspace --package smriti-api

# Then the app itself, installed in place: the code finds the repository's data files relative
# to its own path (smriti_api.core.config.REPO_ROOT), so the image keeps the repository layout.
COPY apps/api/smriti_api apps/api/smriti_api
RUN uv sync --frozen --no-dev --package smriti-api \
 && python -m compileall -q apps/api/smriti_api

# --- runtime ------------------------------------------------------------------------------------
FROM ${PYTHON_IMAGE} AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH=/app/.venv/bin:$PATH \
    PORT=8000 \
    WEB_CONCURRENCY=2
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home-dir /home/app --create-home --shell /usr/sbin/nologin app
WORKDIR /app

COPY --from=build /app /app
# Read at runtime: flag defaults, variant configs, server copy, and the migrations and config seed
# the release step applies (python -m smriti_api.migrate).
COPY packages/config/flag-defaults.json packages/config/flag-defaults.json
COPY packages/config/variants packages/config/variants
COPY packages/config/brand.json packages/config/brand.json
COPY packages/analytics/catalogue.json packages/analytics/catalogue.json
COPY packages/i18n/src/locales packages/i18n/src/locales
COPY supabase/migrations supabase/migrations
COPY supabase/seed.sql supabase/seed.sql

USER app
EXPOSE 8000
# Liveness only. Railway gates each deploy on /readyz (database and Redis), see api.railway.json.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/healthz' % os.environ.get('PORT', '8000'), timeout=4)"]
# Gunicorn with Uvicorn workers (TRD §5, smriti_api/server.py). Gunicorn itself binds 0.0.0.0:$PORT
# and starts $WEB_CONCURRENCY workers. --timeout kills a worker whose event loop stops checking in;
# --graceful-timeout fits inside Railway's drainingSeconds (25) in api.railway.json.
CMD ["gunicorn", "smriti_api.main:app", "--worker-class", "smriti_api.server.Worker", "--forwarded-allow-ips=*", "--keep-alive", "5", "--timeout", "30", "--graceful-timeout", "20"]
