# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class Cards(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    order: Annotated[
        list[str], Field(description="Every card id of the new version, in order.")
    ]
    upsert: Annotated[
        list[dict[str, Any]], Field(description="Added and changed cards, whole.")
    ]
    removed: list[str]


class Maps(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    upsert: dict[str, Any]
    removed: list[str]


class BundlePatch(BaseModel):
    """
    A delta patch from one bundle version to another (TRD 3.2), at patches/{from_hash}-{to_hash}.json, immutable. Applying it to the from bundle gives exactly the to bundle (same canonical hash).
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[Literal["patch@1"], Field(alias="schema")]
    bundle_id: str
    from_hash: Annotated[str, Field(pattern="^[0-9a-f]{64}$")]
    to_hash: Annotated[str, Field(pattern="^[0-9a-f]{64}$")]
    set: Annotated[
        dict[str, Any],
        Field(
            description="Top-level fields (other than cards and the keyed maps) whose value changed, with the new value."
        ),
    ]
    unset: Annotated[list[str], Field(description="Top-level fields removed.")]
    cards: Cards
    maps: Annotated[
        dict[Literal["questions", "mnemonics", "sheets", "media", "math"], Maps],
        Field(
            description="Changes to the keyed maps (questions, mnemonics, sheets, media, math)."
        ),
    ]
