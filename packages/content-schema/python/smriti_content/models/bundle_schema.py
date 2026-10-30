# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import blueprint_schema, card_schema, common_schema, media_requests_schema


class Topic(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: str
    chapter: str
    subject: str
    name: str
    summary: str | None = None


class Concept(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: str
    name: str
    kind: str
    intrinsic_depth: int
    summary: str
    key_points: list[str]


class Bite(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: str
    title: str
    subtopic: str | None = None
    card_ids: list[str]
    estimated_minutes: float
    derived: Annotated[
        bool | None,
        Field(
            description="true when the bite was derived from summary cards because the lesson has no bites[]"
        ),
    ] = None


class Questions(BaseModel):
    id: str
    type: blueprint_schema.QuestionType


class PyqPapers(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    exam: str
    exam_name: str
    year: int
    session_label: str | None = None


type BundleMode = Annotated[
    Literal["deep_dive", "quick_revision", "practice"],
    Field(
        description="Lesson bundles (deep_dive, quick_revision) and the topic's practice bundle (practice, lesson and placement questions)."
    ),
]


class Sim(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: str
    version: str
    entry: str
    aspect: str
    size_bytes: int
    origin: str
    licence: str
    attribution: str | None = None


class RenderedMath(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    tex: str
    display: bool
    svg: Annotated[
        str,
        Field(
            description="Self-contained SVG with glyphs as paths; fill is currentColor so one asset serves light and dark themes."
        ),
    ]
    width_ex: float
    height_ex: float
    vertical_align_ex: float


class Card(BaseModel):
    id: str
    type: card_schema.CardType
    concepts: list[str]
    depth: Annotated[int, Field(ge=1, le=5)]


class ResolvedMedia(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    ref: str
    kind: media_requests_schema.MediaKind
    status: Annotated[
        Literal["ready", "unavailable"],
        Field(
            description="ready: url points to the immutable asset. unavailable: not approved yet (fixtures and local builds only); the player shows the card's fallback or alt text."
        ),
    ]
    url: Annotated[
        str | None,
        Field(
            description="Relative to the CDN root, for example assets/{sha256}.webp."
        ),
    ]
    sha256: str | None = None
    mime: str | None = None
    bytes: int | None = None
    width: int | None = None
    height: int | None = None
    alt: str | None = None
    decorative: bool | None = None
    transcript: str | None = None
    label_anchors: list[common_schema.LabelAnchor] | None = None
    sim: Sim | None = None


class Bundle(BaseModel):
    """
    A published bundle: one topic x mode x locale, immutable, named {topic}.{mode}.{locale}.{sha256}.json. Text is resolved to the bundle's locale; media and maths are resolved into the media and math maps. Mock and daily answer keys never appear here.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[Literal["bundle@1"], Field(alias="schema")]
    id: Annotated[str, Field(description="{topic_id}:{mode}:{locale}")]
    fixture: bool | None = None
    topic: Topic
    mode: BundleMode
    locale: common_schema.Locale
    min_app_version: str
    lesson_id: str | None = None
    estimated_minutes: float | None = None
    min_depth: int | None = None
    max_depth: int | None = None
    concepts: list[Concept]
    bites: list[Bite]
    cards: list[Card]
    questions: dict[str, Questions]
    mnemonics: dict[str, dict[str, Any]]
    sheets: dict[str, dict[str, Any]]
    pyq_papers: Annotated[
        dict[str, PyqPapers] | None,
        Field(
            description='Papers the bundle\'s PYQ questions come from, for the Tough one chip ("Asked in {exam_name} {year}").'
        ),
    ] = None
    media: dict[str, ResolvedMedia]
    math: Annotated[
        dict[str, RenderedMath],
        Field(
            description='Keyed by the exact TeX source with its delimiters, for example "$x^2$" or "$$E=mc^2$$". Text fields keep their $...$ segments; latex fields are keyed as display maths ($$...$$), formula symbols as inline maths.'
        ),
    ]
