# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import blueprint_schema, common_schema
from .common_schema import FileMeta

type QuestionType = blueprint_schema.QuestionType


type QuestionUse = Annotated[
    Literal["practice", "lesson", "placement", "mock", "daily"],
    Field(
        description="practice: practice bank and drills. lesson: lesson check cards. placement: Find my level sets. mock and daily: keys stay on the server, so a question with mock or daily cannot also be practice, lesson or placement."
    ),
]


class CommonTrap(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    option_id: common_schema.Slug | None = None
    why: common_schema.I18nText


class Solution(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    feynman: common_schema.I18nText
    steps: list[common_schema.I18nText]
    shortcut: common_schema.I18nText | None = None
    shortcut_fails_when: common_schema.I18nText | None = None
    common_traps: list[CommonTrap] | None = None


class Concept(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.ConceptId
    weight: Annotated[float, Field(gt=0.0, le=1.0)]


class Pyq(BaseModel):
    """
    Back-link to the paper, required when source is pyq.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    paper: Annotated[str, Field(pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$")]
    number: Annotated[int, Field(ge=1)]


class QuestionBase(BaseModel):
    id: common_schema.QuestionId
    type: QuestionType
    concepts: Annotated[list[Concept], Field(min_length=1)]
    depth: common_schema.Depth
    exam_styles: list[common_schema.ExamId] | None = None
    stem: common_schema.I18nText
    hints: Annotated[
        list[common_schema.I18nText] | None,
        Field(
            description="Hints for the first wrong try, used when the picked option has no common_traps entry (learn G3)."
        ),
    ] = None
    solution: Solution | None = None
    ideal_time_s: Annotated[int | None, Field(ge=1)] = None
    difficulty_estimate: Literal["easy", "medium", "hard"] | None = None
    media: common_schema.ImageRef | None = None
    use: Annotated[list[QuestionUse], Field(min_length=1)]
    source: Literal["original", "pyq", "ncert_exemplar", "adapted"] | None = None
    pyq: Annotated[
        Pyq | None,
        Field(description="Back-link to the paper, required when source is pyq."),
    ] = None


type Options = Annotated[list[common_schema.IdText], Field(max_length=6, min_length=2)]


class OptionAnswer(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    option_ids: Annotated[list[common_schema.Slug], Field(min_length=1)]


class SingleOptionAnswer(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    option_ids: Annotated[list[common_schema.Slug], Field(max_length=1, min_length=1)]


class McqSingle(QuestionBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Annotated[
        Literal["mcq_single"],
        Field(
            description="drawing: graded by examiners, never by the mock engine. skill_test: a qualifying skill test (typing, data entry) with no questions or marks."
        ),
    ]
    options: Options
    answer: SingleOptionAnswer
    solution: Solution


class McqMulti(QuestionBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Annotated[
        Literal["mcq_multi"],
        Field(
            description="drawing: graded by examiners, never by the mock engine. skill_test: a qualifying skill test (typing, data entry) with no questions or marks."
        ),
    ]
    options: Options
    answer: OptionAnswer
    solution: Solution


class AssertionReason(QuestionBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Annotated[
        Literal["assertion_reason"],
        Field(
            description="drawing: graded by examiners, never by the mock engine. skill_test: a qualifying skill test (typing, data entry) with no questions or marks."
        ),
    ]
    assertion: common_schema.I18nText
    reason: common_schema.I18nText
    options: Options
    answer: SingleOptionAnswer
    solution: Solution


class StatementBased(QuestionBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Annotated[
        Literal["statement_based"],
        Field(
            description="drawing: graded by examiners, never by the mock engine. skill_test: a qualifying skill test (typing, data entry) with no questions or marks."
        ),
    ]
    statements: Annotated[list[common_schema.I18nText], Field(min_length=2)]
    options: Options
    answer: SingleOptionAnswer
    solution: Solution


class Answer(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: float
    tolerance: common_schema.Tolerance | None = None
    unit: common_schema.Unit


class AnswerFormat(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    allow_scientific: bool | None = None
    decimals: Annotated[int | None, Field(ge=0)] = None


class Numerical(QuestionBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Annotated[
        Literal["numerical"],
        Field(
            description="drawing: graded by examiners, never by the mock engine. skill_test: a qualifying skill test (typing, data entry) with no questions or marks."
        ),
    ]
    answer: Answer
    answer_format: AnswerFormat | None = None
    solution: Solution


class Answer1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: int
    unit: common_schema.Unit | None = None


class Integer(QuestionBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Annotated[
        Literal["integer"],
        Field(
            description="drawing: graded by examiners, never by the mock engine. skill_test: a qualifying skill test (typing, data entry) with no questions or marks."
        ),
    ]
    answer: Answer1
    solution: Solution


class Pair(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    row: common_schema.Slug
    columns: list[common_schema.Slug]


class Answer2(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    pairs: Annotated[
        list[Pair],
        Field(description="Each row with the column ids that match it.", min_length=1),
    ]


class MatrixMatch(QuestionBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Annotated[
        Literal["matrix_match"],
        Field(
            description="drawing: graded by examiners, never by the mock engine. skill_test: a qualifying skill test (typing, data entry) with no questions or marks."
        ),
    ]
    rows: Annotated[list[common_schema.IdText], Field(min_length=2)]
    columns: Annotated[list[common_schema.IdText], Field(min_length=2)]
    answer: Answer2
    solution: Solution


class Pair1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    left: common_schema.Slug
    right: common_schema.Slug


class Answer3(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    pairs: Annotated[
        list[Pair1],
        Field(description="Each list_i id with its list_ii id.", min_length=1),
    ]


class MatchList(QuestionBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Annotated[
        Literal["match_list"],
        Field(
            description="drawing: graded by examiners, never by the mock engine. skill_test: a qualifying skill test (typing, data entry) with no questions or marks."
        ),
    ]
    list_i: Annotated[list[common_schema.IdText], Field(min_length=2)]
    list_ii: Annotated[list[common_schema.IdText], Field(min_length=2)]
    options: Options | None = None
    answer: SingleOptionAnswer | Answer3
    solution: Solution


class Blank(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.Slug
    choices: Annotated[list[common_schema.IdText] | None, Field(min_length=2)] = None


class Blanks(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    blank: common_schema.Slug
    choice_id: common_schema.Slug


class AcceptedItem(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    key: common_schema.Slug
    text: common_schema.I18nStringList


class Blanks1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    blank: common_schema.Slug
    accepted: Annotated[
        list[AcceptedItem],
        Field(
            description="Accepted typed answers. The event sends only the matched key, never the typed text.",
            min_length=1,
        ),
    ]


class Answer4(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    blanks: Annotated[
        list[Blanks | Blanks1],
        Field(
            description="The key for each blank: a choice id, or the accepted typed answers.",
            min_length=1,
        ),
    ]


class FillBlank(QuestionBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Annotated[
        Literal["fill_blank"],
        Field(
            description="drawing: graded by examiners, never by the mock engine. skill_test: a qualifying skill test (typing, data entry) with no questions or marks."
        ),
    ]
    blanks: Annotated[
        list[Blank],
        Field(description="Blanks appear in the stem as {{blank:<id>}}.", min_length=1),
    ]
    answer: Answer4
    solution: Solution


class Answer5(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    order: Annotated[list[common_schema.Slug], Field(min_length=2)]


class OrderSteps(QuestionBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Annotated[
        Literal["order_steps"],
        Field(
            description="drawing: graded by examiners, never by the mock engine. skill_test: a qualifying skill test (typing, data entry) with no questions or marks."
        ),
    ]
    steps: Annotated[list[common_schema.IdText], Field(min_length=2)]
    answer: Answer5
    solution: Solution


type ChildQuestion = Annotated[
    McqSingle
    | McqMulti
    | Numerical
    | Integer
    | MatrixMatch
    | MatchList
    | AssertionReason
    | StatementBased
    | FillBlank
    | OrderSteps,
    Field(discriminator="type"),
]


class Paragraph(QuestionBase):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Annotated[
        Literal["paragraph"],
        Field(
            description="drawing: graded by examiners, never by the mock engine. skill_test: a qualifying skill test (typing, data entry) with no questions or marks."
        ),
    ]
    passage: common_schema.I18nText
    children: Annotated[
        list[ChildQuestion],
        Field(
            description="Child questions sharing the passage, one card each in the player.",
            min_length=1,
        ),
    ]


type Question = Annotated[
    McqSingle
    | McqMulti
    | Numerical
    | Integer
    | MatrixMatch
    | MatchList
    | AssertionReason
    | StatementBased
    | Paragraph
    | FillBlank
    | OrderSteps,
    Field(discriminator="type"),
]


class QuestionsFile(FileMeta):
    """
    content/questions/{subject}/{chapter_slug}/{topic_slug}.json (question-author, pyq-ingest). Projects to content.questions, question_keys and question_concepts. Practice and lesson answers ship in bundles; mock and daily answers never ship to devices.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["questions@1"], Field(alias="schema")
    ]
    topic: common_schema.TopicId
    questions: Annotated[list[Question], Field(min_length=1)]
