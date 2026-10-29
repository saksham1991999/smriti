# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import common_schema
from .common_schema import FileMeta


class Scope(BaseModel):
    id: common_schema.ExtraId
    scope: Literal["topic", "chapter"]
    topic: common_schema.TopicId | None = None
    chapter: common_schema.DottedId | None = None
    title: common_schema.I18nText
    concepts: Annotated[list[common_schema.ConceptId], Field(min_length=1)]


class SheetFormula(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: common_schema.I18nText
    latex: common_schema.Latex
    vault_id: common_schema.DottedId | None = None
    concept: common_schema.ConceptId | None = None


class Trap(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    mistake: common_schema.I18nText
    correct: common_schema.I18nText


class CheatSheet(FileMeta, Scope):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["cheat_sheet@1"], Field(alias="schema")
    ]
    key_ideas: Annotated[list[common_schema.I18nText], Field(min_length=1)]
    formulas: list[SheetFormula]
    diagram: common_schema.ImageRef | None = None
    mnemonics: list[common_schema.LocalizedRef]
    traps: list[Trap]


class RevisionSheet(FileMeta, Scope):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["revision_sheet@1"], Field(alias="schema")
    ]
    points: Annotated[list[common_schema.I18nText], Field(min_length=1)]
    formulas: list[SheetFormula] | None = None
    diagram: common_schema.ImageRef | None = None


class Page(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    text: common_schema.I18nText
    media: common_schema.ImageRef
    narration: common_schema.LocalizedAudioRef | None = None


class Storybook(FileMeta, Scope):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["storybook@1"], Field(alias="schema")
    ]
    pages: Annotated[list[Page], Field(max_length=12, min_length=6)]


class Experiment(FileMeta, Scope):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["experiment@1"], Field(alias="schema")
    ]
    materials: Annotated[list[common_schema.I18nText], Field(min_length=1)]
    steps: Annotated[list[common_schema.I18nText], Field(min_length=1)]
    safety: Annotated[list[common_schema.I18nText], Field(min_length=1)]
    adult_supervision: bool
    why_it_works: common_schema.I18nText
    media: common_schema.ImageRef | None = None


class Character(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: common_schema.I18nText
    era: common_schema.I18nText
    portrait: common_schema.ImageRef


class DocumentedView(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    view: common_schema.I18nText
    source: common_schema.Source


type Guardrail = Annotated[str, Field(min_length=1)]


class Roleplay(FileMeta, Scope):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["roleplay@1"], Field(alias="schema")
    ]
    character: Character
    documented_views: Annotated[list[DocumentedView], Field(min_length=1)]
    persona_prompt: Annotated[str, Field(min_length=1)]
    goals: Annotated[list[common_schema.I18nText], Field(min_length=1)]
    guardrails: Annotated[list[Guardrail], Field(min_length=1)]
    opening_line: common_schema.I18nText
    suggested_replies: list[common_schema.I18nText] | None = None


class Node(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.Slug
    label: common_schema.I18nText
    concept: common_schema.ConceptId | None = None


class Edge(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    from_: Annotated[common_schema.Slug, Field(alias="from")]
    to: common_schema.Slug


class MindMapTemplate(FileMeta, Scope):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["mind_map_template@1"],
        Field(alias="schema"),
    ]
    nodes: Annotated[list[Node], Field(min_length=1)]
    edges: list[Edge]


type ExtrasFile = Annotated[
    CheatSheet | RevisionSheet | Storybook | Experiment | Roleplay | MindMapTemplate,
    Field(
        description="content/extras/{subject}/{chapter_slug}/...: cheat sheets, revision sheets, storybooks, experiments, role plays and mind-map templates (lesson-author). Each file holds one item; its schema field picks the shape.",
        discriminator="schema_",
        title="ExtrasFile",
    ),
]
