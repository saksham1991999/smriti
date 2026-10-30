# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from datetime import date
from typing import Annotated, Any, Literal

from pydantic import AnyUrl, BaseModel, ConfigDict, Field
from typing_extensions import TypeAliasType

type Common = Annotated[
    Any,
    Field(
        description="Shared definitions used by every Smriti content schema.",
        title="Common",
    ),
]


type Locale = Annotated[
    Literal[
        "en",
        "hi",
        "as",
        "bn",
        "brx",
        "doi",
        "gu",
        "kn",
        "ks",
        "kok",
        "mai",
        "ml",
        "mni",
        "mr",
        "ne",
        "or",
        "pa",
        "sa",
        "sat",
        "sd",
        "ta",
        "te",
        "ur",
    ],
    Field(
        description="A language code: English or a scheduled language of India. Phase 1 ships en and hi. Kept in step with KNOWN_LOCALES in src/localize.ts."
    ),
]


I18nTextAdditionalProperty = TypeAliasType(
    "I18nTextAdditionalProperty", Annotated[str, Field(min_length=1)]
)


type I18nText = Annotated[
    dict[Locale, I18nTextAdditionalProperty],
    Field(
        description='Localised text keyed by locale, for example { "en": "...", "hi": "..." }. Which locales are required is checked per exam profile by the content check, so a new language adds keys, not schema changes.',
        min_length=1,
    ),
]


type I18nStringListAdditionalPropertyItem = Annotated[str, Field(min_length=1)]


I18nStringListAdditionalProperty = TypeAliasType(
    "I18nStringListAdditionalProperty",
    Annotated[list[I18nStringListAdditionalPropertyItem], Field(min_length=1)],
)


type I18nStringList = Annotated[
    dict[Locale, I18nStringListAdditionalProperty],
    Field(
        description="A list of strings per locale (for example accepted fill-in answers).",
        min_length=1,
    ),
]


LocalizedRefAdditionalProperty = TypeAliasType(
    "LocalizedRefAdditionalProperty",
    Annotated[
        str,
        Field(
            pattern="^m\\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*\\.[0-9]+$"
        ),
    ],
)


type LocalizedRef = Annotated[
    dict[Locale, LocalizedRefAdditionalProperty],
    Field(
        description="One content id per locale, for content that is written separately per language (mnemonics).",
        min_length=1,
    ),
]


LocalizedAudioRefAdditionalProperty = TypeAliasType(
    "LocalizedAudioRefAdditionalProperty",
    Annotated[
        str,
        Field(
            pattern="^audio\\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$"
        ),
    ],
)


type LocalizedAudioRef = Annotated[
    dict[Locale, LocalizedAudioRefAdditionalProperty],
    Field(
        description="One audio request per locale (narration is recorded separately for each language).",
        min_length=1,
    ),
]


type Slug = Annotated[str, Field(pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$")]


type DottedId = Annotated[
    str,
    Field(
        description="Lowercase ASCII, dot-separated, hyphens inside a part. Never changes once published.",
        max_length=200,
        pattern="^[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$",
    ),
]


type ConceptId = DottedId


type TopicId = DottedId


type ExamId = Slug


type ExamProfileId = Slug


type CardId = Annotated[
    str,
    Field(
        description="{topic_id}:{dd|qr}:{nn}",
        pattern="^[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*:(dd|qr):[0-9]{2,3}$",
    ),
]


type QuestionId = Annotated[
    str,
    Field(
        description="q.{topic_id}.{nnnn}",
        pattern="^q\\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*\\.[0-9]{4}$",
    ),
]


type MnemonicId = Annotated[
    str,
    Field(
        description="m.{concept_id}.{n}",
        pattern="^m\\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*\\.[0-9]+$",
    ),
]


type ExtraId = Annotated[
    str,
    Field(
        description="cs. cheat sheet, rs. revision sheet, sb. storybook, ex. experiment, rp. role play, mm. mind-map template",
        pattern="^(cs|rs|sb|ex|rp|mm)\\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$",
    ),
]


type MediaRef = Annotated[
    str,
    Field(
        description="A media request id from media/requests/ (never a URL). img. image/diagram/comic, anim. animation, sim. simulation, m3d. 3D model, pano. 360 scene, audio. narration or song.",
        pattern="^(img|anim|sim|m3d|pano|audio)\\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$",
    ),
]


type ImageRef = Annotated[
    str,
    Field(pattern="^img\\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$"),
]


type AnimationRef = Annotated[
    str,
    Field(pattern="^anim\\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$"),
]


type SimRef = Annotated[
    str,
    Field(pattern="^sim\\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$"),
]


type Model3dRef = Annotated[
    str,
    Field(pattern="^m3d\\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$"),
]


type PanoRef = Annotated[
    str,
    Field(pattern="^pano\\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$"),
]


type AudioRef = Annotated[
    str,
    Field(pattern="^audio\\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$"),
]


type SyllabusRef = Annotated[
    str,
    Field(
        description="{exam_profile}:{subject}:{unit}:{item}, a line of the official syllabus",
        pattern="^[a-z0-9-]+:[a-z0-9.-]+:[a-z0-9.-]+:[a-z0-9.-]+$",
    ),
]


type Depth = Annotated[
    int,
    Field(
        description="L1 basic school, L2 board, L3 competitive basics, L4 advanced, L5 elite (PRD 4.2)",
        ge=1,
        le=5,
    ),
]


type IsoDate = date


type Latex = Annotated[
    str,
    Field(
        description="A LaTeX expression without $ delimiters. Rendered to SVG at publish.",
        min_length=1,
    ),
]


type Status = Annotated[
    Literal["draft", "review", "published", "retired"],
    Field(
        description="draft -> review -> published (set by the publish job only) -> retired"
    ),
]


type SourceKind = Literal[
    "ncert", "official", "openstax", "pyq", "textbook", "paper", "dataset", "other"
]


class Source(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: SourceKind
    ref: Annotated[str, Field(min_length=1)]
    url: AnyUrl | None = None
    retrieved: IsoDate | None = None
    pages: str | None = None
    licence: str | None = None
    published: Annotated[
        IsoDate | None,
        Field(description="When the source was published by its author."),
    ] = None
    linked_from: Annotated[
        str | None,
        Field(
            description="The official page the document is linked from, so a reviewer can find it again (a URL, optionally with the menu path).",
            min_length=1,
        ),
    ] = None


class Tolerance(BaseModel):
    """
    Accepted error. A response passes when |response - value| <= max(abs, rel * |value|).
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    abs: Annotated[float | None, Field(ge=0.0)] = None
    rel: Annotated[float | None, Field(ge=0.0, le=1.0)] = None


type Unit = Annotated[
    str | None,
    Field(
        description="A unit symbol, for example m/s, kJ, mol, °C. null for dimensionless."
    ),
]


class LabelAnchor(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Slug
    x: Annotated[float, Field(ge=0.0, le=1.0)]
    y: Annotated[float, Field(ge=0.0, le=1.0)]


class IdText(BaseModel):
    """
    An item with a stable id and localised text (options, list items, steps).
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    id: Slug
    text: I18nText
    media: ImageRef | None = None


type SubjectFamily = Annotated[
    Literal[
        "physics", "chemistry", "biology", "maths", "history", "polity", "language"
    ],
    Field(description="Colour family from packages/tokens/tokens.json `subject`."),
]


class OpenQuestion(BaseModel):
    """
    Something the official source does not state (or that could not be checked). A null exam fact must have one, naming the field.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    field: Annotated[
        str | None,
        Field(
            description="The field left null or unset because of this question, as a dotted path from the file root. Blueprint sections are addressed by code: sections.gs1.marking.mcq_single.correct. null: a question about the file as a whole.",
            min_length=1,
        ),
    ] = None
    question: Annotated[str, Field(min_length=1)]
    checked: Annotated[
        IsoDate | None,
        Field(description="When the sources were last checked for an answer."),
    ] = None
    source_url: Annotated[
        AnyUrl | None, Field(description="Where the answer is expected to appear.")
    ] = None


type HiSource = Annotated[
    Literal["official", "ncert", "translation"],
    Field(
        description="Where the Hindi text of the file comes from: official (the conducting body's Hindi document), ncert (NCERT Hindi-medium books) or translation (our translation of the official English)."
    ),
]


class FileMeta(BaseModel):
    """
    Fields every content file carries.
    """

    schema_: Annotated[str, Field(alias="schema", pattern="^[a-z_-]+@[0-9]+$")]
    status: Status
    sources: list[Source] | None = None
    authored_by: Annotated[str, Field(min_length=1)]
    reviewed_by: str | None = None
    updated: IsoDate
    fixture: Annotated[
        bool | None,
        Field(
            description="Test data only. Fixture files live under content/fixtures/ and can never be published to a non-local target."
        ),
    ] = None
    notes: str | None = None
    open_questions: Annotated[
        list[OpenQuestion] | None,
        Field(
            description="Facts the official sources do not state. Every exam fact left null names its field here."
        ),
    ] = None
    hi_source: HiSource | None = None
