# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import common_schema
from .common_schema import FileMeta

type Technique = Literal[
    "acronym",
    "acrostic",
    "story",
    "rhyme",
    "song",
    "keyword",
    "pao",
    "major_system",
    "peg",
    "palace",
    "chunking",
    "visual",
]


type DecodesToItem = Annotated[str, Field(min_length=1)]


class Mnemonic(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.MnemonicId
    concept: common_schema.ConceptId
    technique: Technique
    origin: Annotated[
        Literal["traditional", "system"],
        Field(
            description="traditional: widely known (cite where it is commonly taught). system: made by the skill."
        ),
    ]
    taught_in: Annotated[
        str | None,
        Field(
            description="Where a traditional mnemonic is commonly taught. Required for traditional ones."
        ),
    ] = None
    locale: common_schema.Locale
    text: Annotated[str, Field(min_length=1)]
    decodes_to: Annotated[
        list[DecodesToItem],
        Field(
            description="The exact facts it encodes, in order, in the mnemonic's locale.",
            min_length=1,
        ),
    ]
    exam_style: str | None = None
    media: common_schema.ImageRef | None = None
    audio: common_schema.AudioRef | None = None
    notes: str | None = None


class MnemonicsFile(FileMeta):
    """
    content/mnemonics/{subject_id}/{chapter_slug}.json (mnemonic-maker). Each item is written for one locale. Projects to content.mnemonics.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["mnemonics@1"], Field(alias="schema")
    ]
    chapter: common_schema.DottedId | None = None
    items: Annotated[list[Mnemonic], Field(min_length=1)]
