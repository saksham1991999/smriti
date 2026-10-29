# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from . import common_schema, mnemonics_schema

type MissingItem = Annotated[int, Field(ge=0)]


class Decode(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    covered: Annotated[int, Field(ge=0)]
    total: Annotated[int, Field(ge=0)]
    in_order: bool
    missing: list[MissingItem]


class ImageRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    preset: Literal["memory-hook"]
    prompt_ref: str


class ForgeDraft(BaseModel):
    """
    A Make it stick draft (memory-labs 5.7, gap G26), shared by POST /v1/ai/memory-cue and the tutor's forge_mnemonic tool.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    draft_id: UUID
    concept_id: common_schema.ConceptId | None = None
    card_ref: Annotated[str | None, Field(pattern="^(c|u|q):.+$")] = None
    source_card_id: str | None = None
    locale: common_schema.Locale
    exam_style: str | None
    technique: mnemonics_schema.Technique
    text: Annotated[str, Field(min_length=1)]
    decode: Decode
    image_request: ImageRequest | None = None
    audio_ref: str | None = None
    origin: Literal["ai", "user"]
