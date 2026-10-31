"""Sign in with Apple token revocation (auth flow §6.8, Apple TN3194).

On account deletion the iOS app signs in with Apple again and sends the fresh authorization code.
The server exchanges it for a refresh token at ``POST /auth/token`` and revokes that token at
``POST /auth/revoke``, which removes the app from the user's Apple ID.

The client secret is an ES256 JWT signed with the Sign in with Apple key (``APPLE_SIGNIN_*``),
``iss`` = team id, ``sub`` = the client id (the variant's bundle id), ``aud`` =
``https://appleid.apple.com``. It is made per call with a five-minute lifetime, so no long-lived
secret is stored, and it is never logged.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Protocol

import httpx
import jwt

APPLE_AUDIENCE = "https://appleid.apple.com"
SECRET_TTL_S = 300

# Apple's token errors that mean the code itself is unusable (spent, expired or for another app),
# so the client must sign in with Apple again. Anything else is treated as a transient failure.
CODE_ERRORS = {"invalid_grant", "invalid_client", "unauthorized_client", "invalid_request"}


class AppleRevokeError(Exception):
    """``code`` is ``apple_code_invalid``, ``apple_client_unknown``, ``apple_unavailable`` or
    ``apple_signin_not_configured``."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code


class AppleSignIn(Protocol):
    client_ids: tuple[str, ...]

    async def revoke_authorization_code(self, code: str, client_id: str) -> None:
        """Exchanges ``code`` and revokes the tokens. Raises ``AppleRevokeError``."""
        ...


def parse_client_ids(raw: str) -> tuple[str, ...]:
    return tuple(dict.fromkeys(c.strip() for c in raw.split(",") if c.strip()))


def client_secret(
    *, team_id: str, key_id: str, private_key: str, client_id: str, now: int | None = None
) -> str:
    issued = int(time.time()) if now is None else now
    claims = {
        "iss": team_id,
        "iat": issued,
        "exp": issued + SECRET_TTL_S,
        "aud": APPLE_AUDIENCE,
        "sub": client_id,
    }
    # Railway variables often hold a PEM with literal "\n".
    pem = private_key.replace("\\n", "\n")
    return jwt.encode(claims, pem, algorithm="ES256", headers={"kid": key_id})


class AppleSignInClient:
    def __init__(
        self,
        http: httpx.AsyncClient,
        *,
        team_id: str,
        key_id: str,
        private_key: str,
        client_ids: tuple[str, ...],
        base_url: str = APPLE_AUDIENCE,
        timeout_s: float = 10.0,
    ) -> None:
        self._http = http
        self._team_id = team_id
        self._key_id = key_id
        self._private_key = private_key
        self.client_ids = client_ids
        self._base = base_url.rstrip("/")
        self._timeout = timeout_s

    def _secret(self, client_id: str) -> str:
        return client_secret(
            team_id=self._team_id,
            key_id=self._key_id,
            private_key=self._private_key,
            client_id=client_id,
        )

    async def _post(self, path: str, form: dict[str, str]) -> httpx.Response:
        try:
            return await self._http.post(
                f"{self._base}{path}",
                data=form,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=self._timeout,
            )
        except httpx.HTTPError as exc:
            raise AppleRevokeError("apple_unavailable", type(exc).__name__) from exc

    async def revoke_authorization_code(self, code: str, client_id: str) -> None:
        if client_id not in self.client_ids:
            raise AppleRevokeError("apple_client_unknown")
        secret = self._secret(client_id)
        r = await self._post(
            "/auth/token",
            {
                "client_id": client_id,
                "client_secret": secret,
                "code": code,
                "grant_type": "authorization_code",
            },
        )
        if r.status_code != 200:
            error = _error(r)
            if r.status_code == 400 and error in CODE_ERRORS:
                raise AppleRevokeError("apple_code_invalid", error)
            raise AppleRevokeError("apple_unavailable", f"token {r.status_code}")
        tokens = r.json()
        # The refresh token revokes the whole grant; the access token is the fallback.
        if tokens.get("refresh_token"):
            token, hint = str(tokens["refresh_token"]), "refresh_token"
        elif tokens.get("access_token"):
            token, hint = str(tokens["access_token"]), "access_token"
        else:
            raise AppleRevokeError("apple_unavailable", "no token in the exchange")
        r = await self._post(
            "/auth/revoke",
            {
                "client_id": client_id,
                "client_secret": secret,
                "token": token,
                "token_type_hint": hint,
            },
        )
        if r.status_code != 200:
            raise AppleRevokeError("apple_unavailable", f"revoke {r.status_code} {_error(r)}")


def _error(r: httpx.Response) -> str:
    try:
        return str(r.json().get("error", ""))
    except ValueError:
        return ""


@dataclass
class FakeAppleSignIn:
    """Local and test. The code ``invalid`` behaves like a spent code; ``unavailable`` like an
    Apple outage. Every other code is recorded as revoked."""

    client_ids: tuple[str, ...] = tuple(
        f"app.smriti.{v}" for v in ("all", "jee", "neet", "upsc", "ssc")
    )
    revoked: list[tuple[str, str]] = field(default_factory=list)

    async def revoke_authorization_code(self, code: str, client_id: str) -> None:
        if client_id not in self.client_ids:
            raise AppleRevokeError("apple_client_unknown")
        if code == "invalid":
            raise AppleRevokeError("apple_code_invalid", "invalid_grant")
        if code == "unavailable":
            raise AppleRevokeError("apple_unavailable", "fake outage")
        self.revoked.append((code, client_id))


@dataclass
class DisabledAppleSignIn:
    """Outside local and test without the APPLE_SIGNIN_* settings: every call refuses."""

    client_ids: tuple[str, ...] = ()

    async def revoke_authorization_code(self, code: str, client_id: str) -> None:
        raise AppleRevokeError("apple_signin_not_configured")


def build_apple_signin(
    http: httpx.AsyncClient,
    *,
    dev: bool,
    base_url: str,
    team_id: str,
    key_id: str,
    private_key: str,
    client_ids: str,
) -> AppleSignIn:
    ids = parse_client_ids(client_ids)
    if team_id and key_id and private_key and ids:
        return AppleSignInClient(
            http,
            team_id=team_id,
            key_id=key_id,
            private_key=private_key,
            client_ids=ids,
            base_url=base_url,
        )
    if dev:
        return FakeAppleSignIn(client_ids=ids or FakeAppleSignIn().client_ids)
    return DisabledAppleSignIn()
