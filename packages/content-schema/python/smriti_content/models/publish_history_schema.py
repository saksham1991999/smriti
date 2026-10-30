# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class Bundle(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    hash: Annotated[str, Field(pattern="^[0-9a-f]{64}$")]
    version: Annotated[int, Field(ge=1)]
    size_bytes: Annotated[int, Field(ge=1)]
    published_at: AwareDatetime


class Manifest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    hash: Annotated[str, Field(pattern="^[0-9a-f]{64}$")]
    version: Annotated[int, Field(ge=1)]
    published_at: AwareDatetime


class Item(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    version: Annotated[int, Field(ge=1)]
    hashes: Annotated[dict[str, str], Field(description="locale -> content hash")]
    published_at: AwareDatetime


class PublishHistory(BaseModel):
    """
    publish-history.json in the output target: every hash ever published per bundle, manifest and content item, so versions stay monotonic and patches can be built from earlier versions. Mirrors content.bundle_history.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[Literal["publish-history@1"], Field(alias="schema")]
    fixture: bool | None = None
    bundles: dict[str, list[Bundle]]
    manifests: dict[str, list[Manifest]]
    items: dict[str, list[Item]]
