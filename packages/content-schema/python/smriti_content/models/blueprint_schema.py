# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AnyUrl, BaseModel, ConfigDict, Field
from typing_extensions import TypeAliasType

from . import common_schema
from .common_schema import FileMeta


class ExamDay(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    reporting_lead_min: Annotated[int | None, Field(ge=0)] = None


class Accommodations(BaseModel):
    """
    Extra time and other accommodations, only where the official notification defines them.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    extra_time_min_per_hour: Annotated[float, Field(ge=0.0)]
    source_ref: str


type QuestionType = Annotated[
    Literal[
        "mcq_single",
        "mcq_multi",
        "numerical",
        "integer",
        "matrix_match",
        "match_list",
        "assertion_reason",
        "statement_based",
        "paragraph",
        "fill_blank",
        "order_steps",
        "drawing",
        "skill_test",
    ],
    Field(
        description="drawing: graded by examiners, never by the mock engine. skill_test: a qualifying skill test (typing, data entry) with no questions or marks."
    ),
]


class Wrong(BaseModel):
    """
    Marks for a wrong answer (negative or 0), or a penalty as a fraction of the question's marks (UPSC: one-third).
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    fraction_of_question_marks: Annotated[float, Field(gt=0.0, le=1.0)]


class Partial(BaseModel):
    """
    JEE Advanced-style partial marking: per correct option chosen, only when no wrong option is chosen.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    per_correct_option: float
    requires_no_wrong: bool


TypeCountsAdditionalProperty = TypeAliasType(
    "TypeCountsAdditionalProperty", Annotated[int, Field(ge=0)]
)


class AttemptRule(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    attempt_any: Annotated[int | None, Field(ge=1)]
    over_attempt: Literal["block", "evaluate_first_n"] | None = None


class QualifyingRule1(BaseModel):
    """
    A notified qualifying standard: one value, a value per category, or a standard the conducting body sets later.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["percent_of_max", "marks", "percentile", "max_error_percent"]
    value: Annotated[float, Field(ge=0.0)]
    source_ref: Annotated[str | None, Field(min_length=1)] = None


class ByCategoryItem(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    category: Annotated[str, Field(min_length=1)]
    value: Annotated[float, Field(ge=0.0)]


class QualifyingRule2(BaseModel):
    """
    A notified qualifying standard: one value, a value per category, or a standard the conducting body sets later.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["percent_of_max", "marks", "percentile", "max_error_percent"]
    by_category: Annotated[
        list[ByCategoryItem],
        Field(
            description="Category labels as the notice prints them (UR, OBC/EWS, SC, ST, PwBD ...).",
            min_length=1,
        ),
    ]
    source_ref: Annotated[str | None, Field(min_length=1)] = None


class QualifyingRule3(BaseModel):
    """
    A notified qualifying standard: one value, a value per category, or a standard the conducting body sets later.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["set_by_conducting_body"]
    basis: Annotated[
        str,
        Field(description="What the notice says about how it is set.", min_length=1),
    ]
    source_ref: Annotated[str | None, Field(min_length=1)] = None


type QualifyingRule = Annotated[
    QualifyingRule1 | QualifyingRule2 | QualifyingRule3,
    Field(
        description="A notified qualifying standard: one value, a value per category, or a standard the conducting body sets later."
    ),
]


class Source(BaseModel):
    """
    The official notification this blueprint was encoded from.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    url: AnyUrl
    title: Annotated[str, Field(min_length=1)]
    published: common_schema.IsoDate
    retrieved: common_schema.IsoDate
    pages: str | None = None
    linked_from: Annotated[
        str | None,
        Field(
            description="The official page the notice is linked from (a URL, optionally with the menu path).",
            min_length=1,
        ),
    ] = None


class Qualifying(BaseModel):
    """
    The paper's qualifying rule, only as notified. null: none is notified.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    rule: QualifyingRule | None
    basis: Annotated[
        str | None,
        Field(
            description="The notified rule in our words, with its citation.",
            min_length=1,
        ),
    ] = None
    source_ref: Annotated[str | None, Field(min_length=1)] = None


class Group(BaseModel):
    """
    Paired papers taken together (JEE Advanced paper 1 and 2, UPSC GS I and CSAT).
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.Slug
    order: Annotated[int, Field(ge=1)]
    break_min: Annotated[int | None, Field(ge=0)] = None


class MarkingRule(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    correct: Annotated[
        float | None,
        Field(
            description="Marks for a right answer. null: not stated in the notice; the file then lists an open_questions entry naming this field."
        ),
    ]
    wrong: Annotated[
        float | Wrong,
        Field(
            description="Marks for a wrong answer (negative or 0), or a penalty as a fraction of the question's marks (UPSC: one-third)."
        ),
    ]
    unattempted: float
    partial: Annotated[
        Partial | None,
        Field(
            description="JEE Advanced-style partial marking: per correct option chosen, only when no wrong option is chosen."
        ),
    ] = None
    tolerance: Annotated[
        Literal["as_notified"] | common_schema.Tolerance | None,
        Field(description="Numerical answers: as_notified, or the notified tolerance."),
    ] = None


class Section(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    code: common_schema.Slug
    title: common_schema.I18nText
    subject: str | None = None
    timer_min: Annotated[int | None, Field(ge=1)] = None
    question_count: Annotated[
        int | None,
        Field(
            description="null for a qualifying skill test, or when the notice does not state it (then an open_questions entry names sections.{code}.question_count).",
            ge=1,
        ),
    ]
    type_counts: Annotated[
        dict[QuestionType, TypeCountsAdditionalProperty] | None,
        Field(
            description="Questions per type, when a section mixes types. Lets the check add up marks."
        ),
    ] = None
    attempt_rule: AttemptRule | None = None
    optional: bool | None = None
    cutoff: Annotated[
        QualifyingRule | None,
        Field(
            description="Sectional cut-off or qualifying standard, only when notified."
        ),
    ] = None
    question_types: Annotated[list[QuestionType], Field(min_length=1)]
    marking: Annotated[
        dict[QuestionType, MarkingRule] | None,
        Field(
            description="Required, except for a section of skill_test questions only.",
            min_length=1,
        ),
    ] = None
    mode: Annotated[
        Literal["cbt", "pen_paper"] | None,
        Field(description="Only in a mixed paper: the mode of this section."),
    ] = None
    max_marks: Annotated[
        float | None,
        Field(
            description="The section total as notified, when the notice prints it (needed when marks per question are not stated).",
            gt=0.0,
        ),
    ] = None


class PaletteState(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Literal["not_visited", "not_answered", "answered", "marked", "answered_marked"]
    label: common_schema.I18nText
    colour_token: Annotated[
        str,
        Field(
            description="A key under mockPalette in packages/tokens/tokens.json, for example mockPalette.answered.",
            pattern="^mockPalette\\.[A-Za-z]+$",
        ),
    ]
    shape: Literal["square", "circle", "pentagon-up", "pentagon-down", "circle-tick"]


class Button(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    action: Literal[
        "save_next",
        "save_mark_review",
        "mark_review_next",
        "clear_response",
        "back",
        "next",
        "submit",
    ]
    label: common_schema.I18nText


class InterfaceProfile(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    buttons: Annotated[list[Button], Field(min_length=1)]
    palette_states: Annotated[list[PaletteState], Field(min_length=1)]
    save_requires_explicit_action: Annotated[
        bool | None,
        Field(
            description="null: not stated in the official instructions (with an open_questions entry naming interface_profile.save_requires_explicit_action)."
        ),
    ]
    clear_keeps_mark: Annotated[
        bool | None,
        Field(
            description="null: not stated in the official instructions (with an open_questions entry naming interface_profile.clear_keeps_mark)."
        ),
    ]
    marked_answer_evaluated: Annotated[
        bool | None,
        Field(
            description="null: not stated in the official instructions (with an open_questions entry naming interface_profile.marked_answer_evaluated)."
        ),
    ]
    keyboard_disabled_on_exam_day: Annotated[
        bool | None,
        Field(
            description="null: not stated in the official instructions (with an open_questions entry naming interface_profile.keyboard_disabled_on_exam_day)."
        ),
    ] = None


class BlueprintFile(FileMeta):
    """
    content/blueprints/{exam_profile_id}/{paper_code}.v{n}.json, encoded by skills/exam-blueprint from the latest official notification. Projects to content.exam_blueprints.spec. Never edited in place: a pattern change is a new version.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["blueprint@1"], Field(alias="schema")
    ]
    exam_profile: common_schema.ExamProfileId
    paper_code: common_schema.Slug
    version: Annotated[int, Field(ge=1)]
    effective_from: common_schema.IsoDate
    verified_at: common_schema.IsoDate
    source: Annotated[
        Source,
        Field(description="The official notification this blueprint was encoded from."),
    ]
    mode: Annotated[
        Literal["cbt", "pen_paper", "mixed"],
        Field(
            description="cbt, pen_paper, or mixed when parts of the paper are taken in different modes (each section then says its mode)."
        ),
    ]
    duration_min: Annotated[int, Field(ge=1)]
    languages: Annotated[list[common_schema.Locale], Field(min_length=1)]
    language_switch: Annotated[
        Literal["per_question", "fixed"],
        Field(
            description="per_question: the EN/HI toggle shows on every question in full, sectional and PYQ-paper mocks. fixed: the language is chosen once (practice flow 6.4, R44)."
        ),
    ]
    interface: Literal["nta", "nta_omr", "upsc_omr", "ssc_tcs", "generic"]
    interface_profile: Annotated[
        InterfaceProfile | None,
        Field(
            description="Buttons, labels and palette states encoded from the official instructions. null: the runner uses the generic profile."
        ),
    ] = None
    calculator: Annotated[
        Literal["none", "basic", "scientific"] | None,
        Field(
            description="Calculator allowed on the paper. null: not stated in the notice; the file then lists an open_questions entry naming this field."
        ),
    ]
    section_navigation: Annotated[
        Literal["free", "locked_in_order", "free_within_timer"] | None,
        Field(
            description="How candidates move between sections. null: not stated in the notice; the file then lists an open_questions entry naming this field."
        ),
    ]
    early_section_submit: Annotated[
        bool | None,
        Field(
            description="Whether a locked section can be submitted before its timer ends. null when the notification is silent."
        ),
    ] = None
    numeric_input: Annotated[
        Literal["virtual_keypad", "keyboard"] | None,
        Field(
            description="How numeric answers are typed. null: not stated in the notice; the file then lists an open_questions entry naming this field."
        ),
    ]
    question_count: Annotated[
        int | None,
        Field(
            description="Questions that count in the paper (after attempt-any rules). null: not stated in the notice; the file then lists an open_questions entry naming this field.",
            ge=1,
        ),
    ]
    max_marks: Annotated[float, Field(gt=0.0)]
    sections: Annotated[list[Section], Field(min_length=1)]
    qualifying: Annotated[
        Qualifying | None,
        Field(
            description="The paper's qualifying rule, only as notified. null: none is notified."
        ),
    ] = None
    exam_day: ExamDay | None = None
    accommodations: Annotated[
        Accommodations | None,
        Field(
            description="Extra time and other accommodations, only where the official notification defines them."
        ),
    ] = None
    group: Annotated[
        Group | None,
        Field(
            description="Paired papers taken together (JEE Advanced paper 1 and 2, UPSC GS I and CSAT)."
        ),
    ] = None
    instructions: common_schema.I18nText
