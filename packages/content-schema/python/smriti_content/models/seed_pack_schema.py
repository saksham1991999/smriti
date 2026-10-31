# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import common_schema


class Manifest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    exam_profile: str
    path: str
    hash: str
    version: int


class Bundle(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: str
    hash: str
    path: str
    size_bytes: int


class Asset(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    ref: str
    sha256: str
    path: str
    bytes: int


class SeedPack(BaseModel):
    """
    seed/{variant_id}/{locale}/seed.json: the index of a built seed pack that ships inside the app build. Projects to content.seed_packs.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[Literal["seed-pack@1"], Field(alias="schema")]
    variant_id: str
    locale: common_schema.Locale
    fixture: bool | None = None
    hash: Annotated[
        str,
        Field(
            description="sha256 over the sorted file hashes in the pack.",
            pattern="^[0-9a-f]{64}$",
        ),
    ]
    total_bytes: Annotated[int, Field(ge=0, le=8388608)]
    manifests: list[Manifest]
    bundles: list[Bundle]
    assets: list[Asset]
