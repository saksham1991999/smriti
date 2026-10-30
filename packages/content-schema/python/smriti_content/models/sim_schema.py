# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import common_schema
from .common_schema import FileMeta


class Measurement(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: Annotated[str, Field(min_length=1)]
    unit: common_schema.Unit
    label: common_schema.I18nText | None = None


class SimManifest(FileMeta):
    """
    sims/{sim_id}/sim.json: a simulation or virtual lab bundle (sim-builder). Projects to content.sims.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["sim@1"], Field(alias="schema")
    ]
    id: common_schema.Slug
    version: Annotated[str, Field(pattern="^[0-9]+\\.[0-9]+\\.[0-9]+$")]
    title: common_schema.I18nText
    origin: Literal["own", "phet", "other_open"]
    licence: Annotated[str, Field(min_length=1)]
    attribution: str | None = None
    entry: Annotated[
        str,
        Field(
            description="The HTML entry point, relative to the bundle root.",
            pattern="^[A-Za-z0-9._/-]+\\.html$",
        ),
    ]
    bridge_version: Annotated[int | None, Field(ge=1)] = None
    locales: Annotated[list[common_schema.Locale], Field(min_length=1)]
    params_schema: Annotated[
        dict[str, Any], Field(description="JSON Schema for init.params.")
    ]
    measurements: Annotated[
        list[Measurement],
        Field(
            description="Measurements the sim can report, which lesson tasks may check."
        ),
    ]
    aspect: Literal["4:3", "1:1", "16:9", "3:4"]
    size_bytes: Annotated[
        int,
        Field(description="Total bundle size. Budget: under 2 MB.", ge=1, le=2097152),
    ]
    supports_low_power: bool | None = None
    poster: common_schema.ImageRef | None = None
    concepts: list[common_schema.ConceptId]
