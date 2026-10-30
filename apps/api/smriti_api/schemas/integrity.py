"""Device attestation (G-10, TRD §14)."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field

KeyId = Annotated[str, Field(min_length=40, max_length=64, pattern=r"^[A-Za-z0-9+/=_-]+$")]


class ChallengeOut(BaseModel):
    nonce: str = Field(description="One-time value to bind into Play Integrity or App Attest")
    expires_in_s: int
    headers: list[str] = Field(
        description="Headers a sensitive call carries: the token (or App Attest assertion, base64),"
        " this nonce, and on iOS the App Attest key id"
    )


class AppAttestKeyIn(BaseModel):
    key_id: KeyId
    attestation: Annotated[str, Field(min_length=8, max_length=16_384)] = Field(
        description="The attestation object from attestKey, base64"
    )
    nonce: Annotated[str, Field(min_length=16, max_length=128)]


class AppAttestKeyOut(BaseModel):
    key_id: str
    environment: Literal["production", "development"]
