"""Domain errors raised by services. Sync turns them into rejected events; REST routes turn them
into RFC 7807 problems with the same ``code``."""

from __future__ import annotations

from smriti_api.core.errors import ApiError


class DomainError(Exception):
    def __init__(self, code: str, detail: str | None = None, status: int = 409) -> None:
        super().__init__(code)
        self.code = code
        self.detail = detail
        self.status = status

    def to_api(self) -> ApiError:
        return ApiError(
            self.status, self.code, self.code.replace("_", " ").capitalize(), self.detail
        )
