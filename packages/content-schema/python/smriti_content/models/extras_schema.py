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


class Page(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    text: common_schema.I18nText
    media: common_schema.ImageRef
    narration: common_schema.LocalizedAudioRef | None = None


class Action(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.Slug
    cue: common_schema.I18nText
    icon: common_schema.IconName


class LyricLine(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    text: Annotated[str, Field(min_length=1)]
    start_ms: Annotated[
        int | None,
        Field(
            description="When the line starts in this version's audio. Timings are both set or both absent.",
            ge=0,
        ),
    ] = None
    end_ms: Annotated[int | None, Field(ge=1)] = None
    action: Annotated[
        common_schema.Slug | None,
        Field(description="An actions[] id to do on this line."),
    ] = None


class Feedback(BaseModel):
    """
    Gentle lines the pet says. No negative words (the content check refuses them).
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    success: common_schema.I18nText
    try_again: common_schema.I18nText


class PlayTile(BaseModel):
    """
    Something the child taps, drags or matches: a picture with a spoken label.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.Slug
    label: common_schema.I18nText
    media: common_schema.ImageRef


class TapRound(BaseModel):
    """
    Tap every picture that fits the prompt ('Tap the red fruits').
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["tap"]
    prompt: common_schema.I18nText
    hint: common_schema.I18nText | None = None
    audio: common_schema.LocalizedAudioRef | None = None
    items: Annotated[list[PlayTile], Field(max_length=6, min_length=2)]
    answer: Annotated[list[common_schema.Slug], Field(min_length=1)]


class Pair(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    left: PlayTile
    right: PlayTile


class MatchRound(BaseModel):
    """
    Join each picture on the left to its partner on the right.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["match"]
    prompt: common_schema.I18nText
    hint: common_schema.I18nText | None = None
    audio: common_schema.LocalizedAudioRef | None = None
    pairs: Annotated[list[Pair], Field(max_length=5, min_length=2)]


class Bucket(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.Slug
    label: common_schema.I18nText
    media: common_schema.ImageRef | None = None


class Item(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.Slug
    label: common_schema.I18nText
    media: common_schema.ImageRef
    bucket: common_schema.Slug


class SortRound(BaseModel):
    """
    Put each picture in its basket ('Living or non-living?').
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["sort"]
    prompt: common_schema.I18nText
    hint: common_schema.I18nText | None = None
    audio: common_schema.LocalizedAudioRef | None = None
    buckets: Annotated[list[Bucket], Field(max_length=3, min_length=2)]
    items: Annotated[list[Item], Field(max_length=8, min_length=2)]


class Target(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.Slug
    label: common_schema.I18nText
    x: Annotated[
        float, Field(description="Centre, 0-1 of the scene width.", ge=0.0, le=1.0)
    ]
    y: Annotated[
        float, Field(description="Centre, 0-1 of the scene height.", ge=0.0, le=1.0)
    ]
    radius: Annotated[
        float,
        Field(
            description="Drop radius, 0-1 of the scene width; generous for small fingers.",
            ge=0.05,
            le=0.5,
        ),
    ]
    accepts: Annotated[
        common_schema.Slug, Field(description="The items[] id that belongs here.")
    ]


class DragRound(BaseModel):
    """
    Drag pictures onto their places in a scene ('Put the hat on the clown'). Extra items are allowed as gentle distractors.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["drag"]
    prompt: common_schema.I18nText
    hint: common_schema.I18nText | None = None
    audio: common_schema.LocalizedAudioRef | None = None
    scene: common_schema.ImageRef
    targets: Annotated[list[Target], Field(max_length=5, min_length=1)]
    items: Annotated[list[PlayTile], Field(max_length=6, min_length=1)]


class TraceRound(BaseModel):
    """
    Trace a letter or digit with a finger. The app draws the glyph from its own font; guide is the stroke-order animation from anim-maker (never hand-drawn paths).
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["trace"]
    prompt: common_schema.I18nText
    hint: common_schema.I18nText | None = None
    audio: common_schema.LocalizedAudioRef | None = None
    glyph: Annotated[str, Field(max_length=3, min_length=1)]
    script: Literal["latin", "devanagari", "digits"]
    guide: common_schema.AnimationRef | None = None
    min_coverage: Annotated[
        float,
        Field(
            description="Share of the glyph the finger must cover, 0.5-0.95.",
            ge=0.5,
            le=0.95,
        ),
    ]


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


class Storybook(FileMeta, Scope):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["storybook@1"], Field(alias="schema")
    ]
    pages: Annotated[list[Page], Field(max_length=12, min_length=6)]


class SongVersion(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    locale: common_schema.Locale
    audio: common_schema.AudioRef
    lines: Annotated[list[LyricLine], Field(max_length=40, min_length=1)]


type Rounds = Annotated[
    TapRound | MatchRound | SortRound | DragRound | TraceRound,
    Field(discriminator="kind"),
]


class Play(FileMeta, Scope):
    """
    A play activity for little learners: one to six short rounds of tap, match, sort, drag or trace. There is no score, timer or fail state: a wrong move bounces back with the try_again line, the second wrong move shows the hint, and after that the player shows the move so every round ends with the child doing it (lesson-core playerRules('little')).
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["play@1"], Field(alias="schema")
    ]
    minutes: Annotated[float, Field(gt=0.0, le=10.0)]
    cover: common_schema.ImageRef | None = None
    feedback: Annotated[
        Feedback,
        Field(
            description="Gentle lines the pet says. No negative words (the content check refuses them)."
        ),
    ]
    rounds: Annotated[list[Rounds], Field(max_length=6, min_length=1)]


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


class Song(FileMeta, Scope):
    """
    A song or rhyme for little learners (PRD §6 'Class 1–5: story, song and play'). Each locale has its own version, written for that language rather than translated, with its own sung audio (an audio_song request with a transcript) and lyric lines. Line timings drive the karaoke highlight once the audio exists.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["song@1"], Field(alias="schema")
    ]
    style: Literal["song", "rhyme", "chant"]
    minutes: Annotated[
        float | None,
        Field(
            description="Length for the HOME-06 path node and the little learner plan; the audio's duration_ms is the truth once generated.",
            gt=0.0,
            le=10.0,
        ),
    ] = None
    cover: common_schema.ImageRef | None = None
    actions: Annotated[
        list[Action] | None,
        Field(
            description="Things to do while singing (clap, jump, point). Lines name them by id.",
            max_length=8,
        ),
    ] = None
    versions: Annotated[list[SongVersion], Field(min_length=1)]


type ExtrasFile = Annotated[
    CheatSheet
    | RevisionSheet
    | Storybook
    | Song
    | Play
    | Experiment
    | Roleplay
    | MindMapTemplate,
    Field(
        description="content/extras/{subject}/{chapter_slug}/...: cheat sheets, revision sheets, storybooks, songs, play activities, experiments, role plays and mind-map templates (lesson-author). Each file holds one item; its schema field picks the shape.",
        discriminator="schema_",
        title="ExtrasFile",
    ),
]
