"""The FastAPI app (TRD §5). ``uvicorn smriti_api.main:app``."""

from __future__ import annotations

import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import httpx
import structlog
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from smriti_api.ai.factory import build_gateway
from smriti_api.core.auth import JwtVerifier
from smriti_api.core.config import JobsMode, Settings, get_settings
from smriti_api.core.db import Database
from smriti_api.core.deps import AppServices
from smriti_api.core.errors import install_error_handlers
from smriti_api.core.idempotency import IdempotencyStore
from smriti_api.core.logging import configure_logging
from smriti_api.core.ratelimit import RateLimiter
from smriti_api.core.redis import create_redis
from smriti_api.core.telemetry import configure_tracing, instrument_app
from smriti_api.integrations import build_integrations
from smriti_api.routes import accounts, catalog, config, dev_auth, game, health, me, sync
from smriti_api.routes import billing as billing_routes
from smriti_api.routes import exports as exports_routes
from smriti_api.routes import guardian as guardian_routes
from smriti_api.routes import mocks as mock_routes
from smriti_api.routes import notify as notify_routes
from smriti_api.routes import practice as practice_routes
from smriti_api.routes import reviews as reviews_routes
from smriti_api.routes import tutor as tutor_routes
from smriti_api.routes import voice as voice_routes
from smriti_api.services.analytics import LogAnalyticsSink
from smriti_api.services.auth_admin import build_auth_admin
from smriti_api.services.jobs import ArqJobQueue, InlineJobQueue, JobDeps, JobQueue, job_registry
from smriti_api.services.privacy import ConsentAwareAnalytics

log = structlog.get_logger("smriti_api")

API_VERSION = "0.1.0"


async def build_services(settings: Settings) -> AppServices:
    db = Database(
        settings.database_url, pool_size=settings.db_pool_size, system_role=settings.db_system_role
    )
    redis = create_redis(settings.redis_url)
    http = httpx.AsyncClient(timeout=30)
    auth_admin = build_auth_admin(settings, db, http)
    analytics = ConsentAwareAnalytics(LogAnalyticsSink(), db)
    integrations = build_integrations(settings, http)
    ai = build_gateway(settings, db, http)
    jobs: JobQueue
    if settings.effective_jobs_mode == JobsMode.inline:
        jobs = InlineJobQueue(
            JobDeps(
                db=db,
                auth_admin=auth_admin,
                analytics=analytics,
                integrations=integrations,
                ai=ai,
            ),
            job_registry(),
        )
    else:
        jobs = ArqJobQueue(settings.redis_url)
    return AppServices(
        settings=settings,
        db=db,
        redis=redis,
        http=http,
        verifier=JwtVerifier(settings, http),
        limiter=RateLimiter(redis),
        idempotency=IdempotencyStore(redis),
        jobs=jobs,
        auth_admin=auth_admin,
        analytics=analytics,
        ai=ai,
        integrations=integrations,
    )


async def close_services(services: AppServices) -> None:
    if isinstance(services.jobs, InlineJobQueue):
        await services.jobs.drain()
    if isinstance(services.jobs, ArqJobQueue):
        await services.jobs.close()
    await services.http.aclose()
    await services.redis.aclose()
    await services.db.dispose()


def create_app(settings: Settings | None = None, services: AppServices | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, settings.log_hash_salt)
    configure_tracing(settings.otel_service_name, settings.otel_exporter_otlp_endpoint)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        owned = services is None
        app.state.services = services or await build_services(settings)
        instrument_app(app, app.state.services.db.engine)
        log.info("api_started", env=settings.app_env.value, jobs=settings.effective_jobs_mode.value)
        try:
            yield
        finally:
            if owned:
                await close_services(app.state.services)

    app = FastAPI(
        title="Smriti API",
        version=API_VERSION,
        description="REST API for the Smriti apps. Errors are RFC 7807 problem details.",
        lifespan=lifespan,
    )
    if services is not None:
        app.state.services = services
    install_error_handlers(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "Idempotency-Key",
            "X-App-Variant",
            "X-Device-Id",
            "X-Platform",
            "X-App-Version",
            "X-Request-Id",
        ],
        expose_headers=["Retry-After", "X-Request-Id"],
        max_age=600,
    )

    @app.middleware("http")
    async def request_log(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
        if len(request_id) > 64 or not request_id.replace("-", "").isalnum():
            request_id = uuid.uuid4().hex
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)
        start = time.perf_counter()
        response = await call_next(request)
        route = request.scope.get("route")
        # The route template, never the raw path or query string (ids and codes stay out of logs).
        path = getattr(route, "path", "unmatched")
        if path not in ("/healthz", "/readyz"):
            log.info(
                "request",
                method=request.method,
                route=path,
                status=response.status_code,
                ms=int((time.perf_counter() - start) * 1000),
                variant=request.headers.get("x-app-variant"),
            )
        response.headers["X-Request-Id"] = request_id
        return response

    for router in (
        health.router,
        config.router,
        me.router,
        sync.router,
        catalog.router,
        accounts.router,
        game.router,
        practice_routes.router,
        mock_routes.router,
        tutor_routes.router,
    ):
        app.include_router(router)
    app.include_router(reviews_routes.router)
    app.include_router(billing_routes.router)
    app.include_router(guardian_routes.router)
    app.include_router(notify_routes.router)
    app.include_router(exports_routes.router)
    app.include_router(voice_routes.router)
    if settings.is_dev:
        app.include_router(dev_auth.router)
        app.include_router(exports_routes.dev_router)
    return app


app = create_app()
