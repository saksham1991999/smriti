# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import ConfigDict, Field

from . import common_schema
from .common_schema import FileMeta

type Chapters = Annotated[
    list[common_schema.DottedId],
    Field(
        description="first: the first chapter (by sort) of the first subject of each profile. Or an explicit list of chapter ids.",
        min_length=1,
    ),
]


class SeedPackSpecFile(FileMeta):
    """
    content/seed-packs/{variant_id}.json: what ships inside one app variant's build (TRD 3.2): the first chapter of its exam, onboarding lessons, placement sets and the pet and plant art. The whole pack stays under 8 MB.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["seed-pack-spec@1"], Field(alias="schema")
    ]
    variant_id: common_schema.Slug
    exam_profiles: Annotated[
        list[common_schema.ExamProfileId],
        Field(
            description="Matches examProfileIds in packages/config/variants/{variant_id}.json.",
            min_length=1,
        ),
    ]
    locales: Annotated[list[common_schema.Locale], Field(min_length=1)]
    chapters: Annotated[
        Literal["first"] | Chapters,
        Field(
            description="first: the first chapter (by sort) of the first subject of each profile. Or an explicit list of chapter ids."
        ),
    ]
    include_placement: Annotated[
        bool | None,
        Field(
            description="Ship the practice bundles that hold Find my level placement questions."
        ),
    ] = None
    art: Annotated[
        list[common_schema.ImageRef],
        Field(
            description="Media request ids for the pet and plant art and other UI art the app needs offline."
        ),
    ]
    max_bytes: Annotated[int | None, Field(ge=1, le=8388608)] = None
