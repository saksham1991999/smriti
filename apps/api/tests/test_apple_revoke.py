"""Sign in with Apple token revocation on account deletion (auth flow §6.8, Apple TN3194)."""

from __future__ import annotations

import uuid
from typing import Any
from urllib.parse import parse_qs

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from smriti_api.core.deps import AppServices
from smriti_api.integrations.apple_signin import (
    AppleRevokeError,
    AppleSignInClient,
    DisabledAppleSignIn,
    FakeAppleSignIn,
    build_apple_signin,
)
from tests.money_helpers import signed_in

CLIENT = "app.smriti.jee"


def _key() -> tuple[str, ec.EllipticCurvePublicKey]:
    private = ec.generate_private_key(ec.SECP256R1())
    pem = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    return pem, private.public_key()


def _client(handler: Any, pem: str) -> tuple[AppleSignInClient, httpx.AsyncClient]:
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client = AppleSignInClient(
        http,
        team_id="TEAM123456",
        key_id="KEY1234567",
        # As a Railway variable usually holds it: one line with literal \n.
        private_key=pem.replace("\n", "\\n"),
        client_ids=(CLIENT, "app.smriti.neet"),
        base_url="https://apple.test",
    )
    return client, http


async def test_exchanges_the_code_and_revokes_the_refresh_token() -> None:
    pem, public = _key()
    calls: list[tuple[str, dict[str, list[str]]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        form = parse_qs(request.content.decode())
        calls.append((request.url.path, form))
        if request.url.path == "/auth/token":
            return httpx.Response(
                200, json={"access_token": "at", "refresh_token": "rt", "id_token": "x"}
            )
        return httpx.Response(200)

    client, http = _client(handler, pem)
    async with http:
        await client.revoke_authorization_code("code-1", CLIENT)

    (token_path, token_form), (revoke_path, revoke_form) = calls
    assert token_path == "/auth/token"
    assert token_form["grant_type"] == ["authorization_code"]
    assert token_form["code"] == ["code-1"]
    assert token_form["client_id"] == [CLIENT]
    secret = token_form["client_secret"][0]
    claims = jwt.decode(secret, public, algorithms=["ES256"], audience="https://appleid.apple.com")
    assert claims["iss"] == "TEAM123456"
    assert claims["sub"] == CLIENT
    assert claims["exp"] - claims["iat"] == 300
    assert jwt.get_unverified_header(secret)["kid"] == "KEY1234567"
    assert revoke_path == "/auth/revoke"
    assert revoke_form["token"] == ["rt"]
    assert revoke_form["token_type_hint"] == ["refresh_token"]


@pytest.mark.parametrize(
    ("status", "body", "code"),
    [
        (400, {"error": "invalid_grant"}, "apple_code_invalid"),
        (503, {}, "apple_unavailable"),
    ],
)
async def test_token_errors(status: int, body: dict[str, str], code: str) -> None:
    pem, _ = _key()
    client, http = _client(lambda _r: httpx.Response(status, json=body), pem)
    async with http:
        with pytest.raises(AppleRevokeError) as err:
            await client.revoke_authorization_code("spent", CLIENT)
    assert err.value.code == code


async def test_unknown_client_and_network_errors() -> None:
    pem, _ = _key()

    def down(_r: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    client, http = _client(down, pem)
    async with http:
        with pytest.raises(AppleRevokeError) as err:
            await client.revoke_authorization_code("c", "com.other.app")
        assert err.value.code == "apple_client_unknown"
        with pytest.raises(AppleRevokeError) as err:
            await client.revoke_authorization_code("c", CLIENT)
        assert err.value.code == "apple_unavailable"


async def test_build_picks_real_fake_or_disabled() -> None:
    pem, _ = _key()
    async with httpx.AsyncClient() as http:
        kw: dict[str, Any] = {"base_url": "https://apple.test", "team_id": "T", "key_id": "K"}
        real = build_apple_signin(http, dev=False, private_key=pem, client_ids=CLIENT, **kw)
        assert isinstance(real, AppleSignInClient)
        assert real.client_ids == (CLIENT,)
        assert isinstance(
            build_apple_signin(http, dev=True, private_key="", client_ids="", **kw), FakeAppleSignIn
        )
        off = build_apple_signin(http, dev=False, private_key="", client_ids="", **kw)
        assert isinstance(off, DisabledAppleSignIn)
        with pytest.raises(AppleRevokeError) as err:
            await off.revoke_authorization_code("c", CLIENT)
        assert err.value.code == "apple_signin_not_configured"


def _fake(services: AppServices) -> FakeAppleSignIn:
    assert services.integrations is not None
    apple = services.integrations.apple_signin
    assert isinstance(apple, FakeAppleSignIn)
    return apple


def _delete(code: str, client_id: str | None = CLIENT) -> dict[str, Any]:
    body: dict[str, str] = {"apple_authorization_code": code}
    if client_id:
        body["apple_client_id"] = client_id
    return body


async def test_deletion_revokes_apple_tokens(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    account = await signed_in(client)
    code = f"code-{uuid.uuid4().hex}"
    r = await client.post(
        "/v1/account/deletion",
        json=_delete(code),
        headers={**account.headers, "Idempotency-Key": f"del-{uuid.uuid4().hex}"},
    )
    assert r.status_code == 202, r.text
    assert r.json()["apple_revoked"] is True
    assert (code, CLIENT) in _fake(services).revoked


async def test_a_spent_apple_code_stops_the_deletion(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    account = await signed_in(client)
    r = await client.post("/v1/account/deletion", json=_delete("invalid"), headers=account.headers)
    assert r.status_code == 401
    assert r.json()["code"] == "apple_reauth_required"
    # Nothing was scheduled.
    assert (await client.get("/v1/me", headers=account.headers)).status_code == 200


async def test_an_apple_outage_does_not_block_deletion(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    account = await signed_in(client)
    r = await client.post(
        "/v1/account/deletion", json=_delete("unavailable"), headers=account.headers
    )
    assert r.status_code == 202, r.text
    assert r.json()["apple_revoked"] is False
    assert (await client.get("/v1/me", headers=account.headers)).status_code == 409


async def test_client_id_is_needed_when_several_apps_are_configured(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    account = await signed_in(client)
    r = await client.post(
        "/v1/account/deletion", json=_delete("code", client_id=None), headers=account.headers
    )
    assert r.status_code == 422
    assert r.json()["code"] == "apple_client_required"


async def test_deletion_without_a_body_still_works(client: httpx.AsyncClient) -> None:
    account = await signed_in(client)
    r = await client.post("/v1/account/deletion", headers=account.headers)
    assert r.status_code == 202, r.text
    assert r.json()["apple_revoked"] is False
