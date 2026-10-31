"""RFC 7807 problem details. Every error the API returns has this shape."""

from __future__ import annotations

from typing import Any

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from opentelemetry import trace
from pydantic import BaseModel, ConfigDict
from starlette.exceptions import HTTPException as StarletteHTTPException

log = structlog.get_logger(__name__)

PROBLEM_JSON = "application/problem+json"


class Problem(BaseModel):
    """Problem details (RFC 7807). `type` is a relative URI naming the problem code."""

    model_config = ConfigDict(extra="allow")

    type: str
    title: str
    status: int
    detail: str | None = None
    code: str
    trace_id: str | None = None


class ApiError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        title: str,
        detail: str | None = None,
        headers: dict[str, str] | None = None,
        **extra: Any,
    ) -> None:
        super().__init__(f"{status} {code}")
        self.status = status
        self.code = code
        self.title = title
        self.detail = detail
        self.headers = headers
        self.extra = extra


def login_required(reason: str) -> ApiError:
    """A guest token hit a hard-login endpoint (auth flow §4). The client opens AUTH-02 with `reason`."""
    return ApiError(401, "login_required", "Sign in to continue", reason=reason)


def not_found(code: str, title: str = "Not found") -> ApiError:
    return ApiError(404, code, title)


def conflict(code: str, title: str, **extra: Any) -> ApiError:
    return ApiError(409, code, title, **extra)


def _trace_id() -> str | None:
    ctx = trace.get_current_span().get_span_context()
    return format(ctx.trace_id, "032x") if ctx.is_valid else None


def problem_response(
    status: int,
    code: str,
    title: str,
    detail: str | None = None,
    headers: dict[str, str] | None = None,
    **extra: Any,
) -> JSONResponse:
    body: dict[str, Any] = {
        "type": code,
        "title": title,
        "status": status,
        "code": code,
        "trace_id": _trace_id(),
    }
    if detail is not None:
        body["detail"] = detail
    body.update(extra)
    return JSONResponse(body, status_code=status, media_type=PROBLEM_JSON, headers=headers)


_HTTP_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    415: "unsupported_media_type",
    429: "rate_limited",
}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return problem_response(
            exc.status, exc.code, exc.title, exc.detail, headers=exc.headers, **exc.extra
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _HTTP_CODES.get(exc.status_code, "http_error")
        detail = exc.detail if isinstance(exc.detail, str) else None
        return problem_response(exc.status_code, code, code.replace("_", " ").capitalize(), detail)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Never echo the submitted values back (they may hold personal data): location and type only.
        errors = [
            {"loc": [str(p) for p in e.get("loc", ())], "type": e.get("type"), "msg": e.get("msg")}
            for e in exc.errors()
        ]
        return problem_response(422, "validation_error", "Invalid request", errors=errors)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled_error", error_type=type(exc).__name__)
        return problem_response(500, "internal_error", "Something went wrong on our side")
