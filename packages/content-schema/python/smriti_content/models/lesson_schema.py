# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import card_schema, common_schema
from .common_schema import FileMeta

type LessonMode = Literal["deep_dive", "quick_revision"]


class Bite(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.Slug
    title: common_schema.I18nText
    subtopic: common_schema.DottedId | None = None
    card_ids: Annotated[list[common_schema.CardId], Field(min_length=1)]
    estimated_minutes: Annotated[float, Field(gt=0.0)]


class LessonFile(FileMeta):
    """
    content/lessons/{subject}/{chapter_slug}/{topic_slug}.{mode}.json: a Deep Dive or Quick Revision for one topic (lesson-author). Projects to content.content_items (kind lesson) and is built into bundles.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["lesson@1"], Field(alias="schema")
    ]
    id: Annotated[
        str,
        Field(
            description="{topic_id}:{mode}",
            pattern="^[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*:(deep_dive|quick_revision)$",
        ),
    ]
    topic: common_schema.TopicId
    mode: LessonMode
    estimated_minutes: Annotated[float, Field(gt=0.0, le=60.0)]
    min_depth: common_schema.Depth
    max_depth: common_schema.Depth
    min_app_version: Annotated[
        str | None,
        Field(
            description="Set when the lesson uses a card renderer newer than the oldest supported app.",
            pattern="^[0-9]+\\.[0-9]+\\.[0-9]+$",
        ),
    ] = None
    concepts: Annotated[list[common_schema.ConceptId], Field(min_length=1)]
    bites: Annotated[
        list[Bite] | None,
        Field(
            description="Deep Dive bites of 2-4 minutes, each ending at LES-08. When missing, a bite ends at each summary card. Every card belongs to exactly one bite, in card order.",
            min_length=1,
        ),
    ] = None
    cards: Annotated[list[card_schema.Card], Field(min_length=1)]
