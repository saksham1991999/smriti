# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import common_schema

type CardType = Literal[
    "story",
    "explainer",
    "formula",
    "animation",
    "interactive",
    "sim",
    "model3d",
    "pano360",
    "derivation",
    "worked_example",
    "question",
    "memory_hook",
    "roleplay",
    "video",
    "experiment",
    "summary",
    "cheat_sheet_ref",
    "common_traps",
]


type YoutubeId = Annotated[str, Field(pattern="^[A-Za-z0-9_-]{11}$")]


class Initial(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    x: float
    y: float


class Target1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    x: float
    y: float
    tolerance: Annotated[float, Field(ge=0.0)]


type Guardrail = Annotated[str, Field(min_length=1)]


class CardBase(BaseModel):
    id: common_schema.CardId
    type: CardType
    concepts: Annotated[list[common_schema.ConceptId], Field(min_length=1)]
    depth: common_schema.Depth
    source: common_schema.Source | None = None


class VideoRef(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    youtube_id: YoutubeId
    start_s: Annotated[int | None, Field(ge=0)] = None


class LabFallback(BaseModel):
    """
    What LAB-05 shows when a sim, 3D model or 360 scene cannot load (memory-labs G2).
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    media: common_schema.ImageRef | None = None
    body: common_schema.I18nText
    video_ref: VideoRef | None = None


class NumericTarget(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: float
    unit: common_schema.Unit
    tolerance: common_schema.Tolerance | None = None


class Panel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    media: common_schema.ImageRef
    caption: common_schema.I18nText | None = None


class StoryCard(CardBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["story"]
    title: common_schema.I18nText
    body: common_schema.I18nText
    media: common_schema.ImageRef | None = None
    panels: Annotated[
        list[Panel] | None,
        Field(
            description="Comic strip panels (2-4), each an image request.",
            max_length=4,
            min_length=2,
        ),
    ] = None
    narration: common_schema.LocalizedAudioRef | None = None


class Highlight(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    term: common_schema.I18nText
    definition: common_schema.I18nText


class ExplainerCard(CardBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["explainer"]
    title: common_schema.I18nText
    body: common_schema.I18nText
    highlights: list[Highlight] | None = None
    media: common_schema.ImageRef
    narration: common_schema.LocalizedAudioRef | None = None


class Symbol(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    symbol: common_schema.Latex
    meaning: common_schema.I18nText
    unit: common_schema.Unit


class FormulaCard(CardBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["formula"]
    title: common_schema.I18nText
    latex: common_schema.Latex
    spoken: common_schema.I18nText | None = None
    symbols: Annotated[list[Symbol], Field(min_length=1)]
    conditions: common_schema.I18nText | None = None
    vault_id: common_schema.DottedId | None = None
    media: common_schema.ImageRef | None = None


class AnimationCard(CardBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["animation"]
    title: common_schema.I18nText
    media: common_schema.AnimationRef
    poster: common_schema.ImageRef | None = None
    caption: common_schema.I18nText
    transcript: common_schema.I18nText


class Bin(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.Slug
    label: common_schema.I18nText


class AnswerItem(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    item: common_schema.Slug
    bin: common_schema.Slug


class Config(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    items: Annotated[list[common_schema.IdText], Field(min_length=2)]
    bins: Annotated[list[Bin], Field(max_length=4, min_length=2)]
    answer: Annotated[
        list[AnswerItem],
        Field(description="Which bin each item belongs in.", min_length=1),
    ]


class Feedback(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    correct: common_schema.I18nText | None = None
    wrong: common_schema.I18nText | None = None


class InteractiveCard1(CardBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["interactive"]
    prompt: common_schema.I18nText
    widget: Literal["drag_sort"]
    config: Config
    feedback: Feedback | None = None
    media: common_schema.ImageRef | None = None


class Target(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: float
    tolerance: common_schema.Tolerance


class Config1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    min: float
    max: float
    step: Annotated[float, Field(gt=0.0)]
    initial: float | None = None
    unit: common_schema.Unit
    target: Target | None = None
    guidance: common_schema.I18nText | None = None


class InteractiveCard2(CardBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["interactive"]
    prompt: common_schema.I18nText
    widget: Literal["slider"]
    config: Config1
    feedback: Feedback | None = None
    media: common_schema.ImageRef | None = None


class Tile(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.Slug
    label: common_schema.I18nText
    text: common_schema.I18nText
    anchor: common_schema.Slug | None = None


class Config3(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    tiles: Annotated[list[Tile], Field(max_length=6, min_length=2)]


class InteractiveCard4(CardBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["interactive"]
    prompt: common_schema.I18nText
    widget: Literal["tap_reveal"]
    config: Config3
    feedback: Feedback | None = None
    media: common_schema.ImageRef | None = None


class Spot(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.Slug
    anchor: common_schema.Slug


class AnswerItem1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    spot: common_schema.Slug
    label: common_schema.Slug


class Config4(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    media: common_schema.ImageRef
    spots: Annotated[list[Spot], Field(min_length=2)]
    labels: Annotated[list[common_schema.IdText], Field(min_length=2)]
    answer: Annotated[
        list[AnswerItem1],
        Field(description="Which label belongs on each spot.", min_length=1),
    ]


class InteractiveCard5(CardBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["interactive"]
    prompt: common_schema.I18nText
    widget: Literal["label_diagram"]
    config: Config4
    feedback: Feedback | None = None
    media: common_schema.ImageRef | None = None


class Config5(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    steps: Annotated[
        list[common_schema.IdText],
        Field(
            description="In the correct order. The player shuffles them.", min_length=2
        ),
    ]


class InteractiveCard6(CardBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["interactive"]
    prompt: common_schema.I18nText
    widget: Literal["order_steps"]
    config: Config5
    feedback: Feedback | None = None
    media: common_schema.ImageRef | None = None


class AnswerItem2(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    item: common_schema.Slug
    bin: common_schema.Slug


class DragSortConfig(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    items: Annotated[list[common_schema.IdText], Field(min_length=2)]
    bins: Annotated[list[Bin], Field(max_length=4, min_length=2)]
    answer: Annotated[
        list[AnswerItem2],
        Field(description="Which bin each item belongs in.", min_length=1),
    ]


class SliderConfig(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    min: float
    max: float
    step: Annotated[float, Field(gt=0.0)]
    initial: float | None = None
    unit: common_schema.Unit
    target: Target | None = None
    guidance: common_schema.I18nText | None = None


class Axis(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    min: float
    max: float
    step: Annotated[float, Field(gt=0.0)]
    label: common_schema.I18nText
    unit: common_schema.Unit | None = None


class GraphConfig(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    x: Axis
    y: Axis
    handle: Literal["point", "curve"]
    initial: Initial | None = None
    target: Target1 | None = None


class TapRevealConfig(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    tiles: Annotated[list[Tile], Field(max_length=6, min_length=2)]


class AnswerItem3(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    spot: common_schema.Slug
    label: common_schema.Slug


class LabelDiagramConfig(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    media: common_schema.ImageRef
    spots: Annotated[list[Spot], Field(min_length=2)]
    labels: Annotated[list[common_schema.IdText], Field(min_length=2)]
    answer: Annotated[
        list[AnswerItem3],
        Field(description="Which label belongs on each spot.", min_length=1),
    ]


class OrderStepsConfig(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    steps: Annotated[
        list[common_schema.IdText],
        Field(
            description="In the correct order. The player shuffles them.", min_length=2
        ),
    ]


class Task(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.Slug
    prompt: common_schema.I18nText
    measurement: Annotated[
        str,
        Field(
            description="The measurement name the sim reports (sim-bridge measurement.name).",
            min_length=1,
        ),
    ]
    expected: NumericTarget


class SimCard(CardBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["sim"]
    title: common_schema.I18nText | None = None
    sim: common_schema.SimRef
    params: dict[str, Any] | None = None
    tasks: list[Task]
    debrief: common_schema.I18nText
    fallback: LabFallback


class Label(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    anchor: Annotated[
        str,
        Field(
            description="Label node name in the GLB, without the label: prefix.",
            pattern="^[a-z0-9_]+$",
        ),
    ]
    text: common_schema.I18nText


class Model3dCard(CardBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["model3d"]
    model: common_schema.Model3dRef
    prompt: common_schema.I18nText
    poster: common_schema.ImageRef | None = None
    labels: list[Label]
    exploded_view: bool
    fallback: LabFallback


class Hotspot(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.Slug
    yaw: Annotated[float, Field(ge=-180.0, le=180.0)]
    pitch: Annotated[float, Field(ge=-90.0, le=90.0)]
    title: common_schema.I18nText
    body: common_schema.I18nText


class Pano360Card(CardBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["pano360"]
    pano: common_schema.PanoRef
    prompt: common_schema.I18nText
    hotspots: list[Hotspot]
    fallback: LabFallback


class Step(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    latex: common_schema.Latex
    say: common_schema.I18nText
    why: common_schema.I18nText | None = None


class DerivationCard(CardBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["derivation"]
    title: common_schema.I18nText
    steps: Annotated[list[Step], Field(min_length=1)]


class WorkedExampleCard(CardBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["worked_example"]
    problem: common_schema.I18nText
    media: common_schema.ImageRef | None = None
    hints: list[common_schema.I18nText] | None = None
    solution_steps: Annotated[list[common_schema.I18nText], Field(min_length=1)]
    answer: common_schema.I18nText
    answer_value: NumericTarget | None = None
    shortcut: common_schema.I18nText | None = None
    common_trap: common_schema.I18nText | None = None


class QuestionCard(CardBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["question"]
    question: common_schema.QuestionId


class MemoryHookCard(CardBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["memory_hook"]
    mnemonic: common_schema.LocalizedRef
    media: common_schema.ImageRef | None = None


class Character(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: common_schema.I18nText
    era: common_schema.I18nText
    portrait: common_schema.ImageRef


class RoleplayCard(CardBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["roleplay"]
    character: Character
    persona_prompt: Annotated[
        str,
        Field(
            description="Instructions for the role-play model: documented views only, cited sources.",
            min_length=1,
        ),
    ]
    goals: Annotated[list[common_schema.I18nText], Field(min_length=1)]
    guardrails: Annotated[list[Guardrail], Field(min_length=1)]
    opening_line: common_schema.I18nText
    suggested_replies: Annotated[list[common_schema.I18nText], Field(max_length=3)]
    script: common_schema.ExtraId | None = None


class ConceptTimestamp(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    concept: common_schema.ConceptId
    t_s: Annotated[int, Field(ge=0)]


class VideoCard(CardBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["video"]
    title: common_schema.I18nText | None = None
    youtube_id: YoutubeId
    start_s: Annotated[int, Field(ge=0)]
    end_s: Annotated[int, Field(ge=1)]
    concept_timestamps: list[ConceptTimestamp] | None = None


class ExperimentCard(CardBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["experiment"]
    title: common_schema.I18nText
    materials: Annotated[list[common_schema.I18nText], Field(min_length=1)]
    steps: Annotated[list[common_schema.I18nText], Field(min_length=1)]
    safety: Annotated[list[common_schema.I18nText], Field(min_length=1)]
    adult_supervision: bool
    why_it_works: common_schema.I18nText
    media: common_schema.ImageRef | None = None


class SummaryCard(CardBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["summary"]
    points: Annotated[
        list[common_schema.I18nText],
        Field(
            description="Key points. Each summary card becomes a spaced-repetition card (c:{card_id}).",
            min_length=1,
        ),
    ]
    media: common_schema.ImageRef | None = None


class CheatSheetRefCard(CardBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["cheat_sheet_ref"]
    sheet: Annotated[
        str,
        Field(
            pattern="^cs\\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$"
        ),
    ]


class Trap(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    mistake: common_schema.I18nText
    correct: common_schema.I18nText


class CommonTrapsCard(CardBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["common_traps"]
    title: common_schema.I18nText | None = None
    traps: Annotated[list[Trap], Field(min_length=1)]


class Config2(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    x: Axis
    y: Axis
    handle: Literal["point", "curve"]
    initial: Initial | None = None
    target: Target1 | None = None


class InteractiveCard3(CardBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["interactive"]
    prompt: common_schema.I18nText
    widget: Literal["graph"]
    config: Config2
    feedback: Feedback | None = None
    media: common_schema.ImageRef | None = None


type InteractiveCard = Annotated[
    InteractiveCard1
    | InteractiveCard2
    | InteractiveCard3
    | InteractiveCard4
    | InteractiveCard5
    | InteractiveCard6,
    Field(discriminator="widget"),
]


type Card = Annotated[
    StoryCard
    | ExplainerCard
    | FormulaCard
    | AnimationCard
    | InteractiveCard
    | SimCard
    | Model3dCard
    | Pano360Card
    | DerivationCard
    | WorkedExampleCard
    | QuestionCard
    | MemoryHookCard
    | RoleplayCard
    | VideoCard
    | ExperimentCard
    | SummaryCard
    | CheatSheetRefCard
    | CommonTrapsCard,
    Field(
        description="One lesson card (PRD 5.2). Every card has id, type, concepts (at least one) and depth (1-5). Text fields are localised; media fields are media request ids, never URLs.",
        discriminator="type",
        title="Card",
    ),
]
