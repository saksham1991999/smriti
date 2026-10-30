"""Pydantic v2 models for Smriti content.

The models in ``smriti_content.models`` are generated from the JSON Schemas in
``packages/content-schema/schemas`` (run ``pnpm --filter @smriti/content-schema gen:python``).
The JSON Schemas are the source of truth; ``pnpm content:check`` is the full validator (it also
checks references, coverage and bilingual completeness). These models are for Python services
that read content and published artefacts: the worker's publish job and the API.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from smriti_content.models import (
    blueprint_schema,
    bundle_schema,
    chapter_schema,
    coverage_inputs_schema,
    coverage_schema,
    exam_map_schema,
    exam_schema,
    extras_schema,
    lesson_schema,
    manifest_schema,
    media_requests_schema,
    mnemonics_schema,
    patch_schema,
    publish_history_schema,
    pyq_paper_schema,
    questions_schema,
    seed_pack_schema,
    seed_pack_spec_schema,
    sim_schema,
    subject_schema,
)

__all__ = ["DOCUMENT_MODELS", "parse_document"]

#: The model for each ``schema`` value a content document carries.
DOCUMENT_MODELS: dict[str, type[BaseModel]] = {
    "exam@1": exam_schema.ExamFile,
    "blueprint@1": blueprint_schema.BlueprintFile,
    "subject@1": subject_schema.SubjectFile,
    "chapter@1": chapter_schema.ChapterFile,
    "exam-map@1": exam_map_schema.ExamMapFile,
    "lesson@1": lesson_schema.LessonFile,
    "questions@1": questions_schema.QuestionsFile,
    "pyq-paper@1": pyq_paper_schema.PyqPaperFile,
    "mnemonics@1": mnemonics_schema.MnemonicsFile,
    "media-requests@1": media_requests_schema.MediaRequestsFile,
    "sim@1": sim_schema.SimManifest,
    "cheat_sheet@1": extras_schema.CheatSheet,
    "revision_sheet@1": extras_schema.RevisionSheet,
    "storybook@1": extras_schema.Storybook,
    "experiment@1": extras_schema.Experiment,
    "roleplay@1": extras_schema.Roleplay,
    "mind_map_template@1": extras_schema.MindMapTemplate,
    "syllabus@1": coverage_inputs_schema.Syllabus,
    "inventory@1": coverage_inputs_schema.Inventory,
    "coverage@1": coverage_schema.CoverageReport,
    "seed-pack-spec@1": seed_pack_spec_schema.SeedPackSpecFile,
    "seed-pack@1": seed_pack_schema.SeedPack,
    "bundle@1": bundle_schema.Bundle,
    "manifest@1": manifest_schema.Manifest,
    "patch@1": patch_schema.BundlePatch,
    "publish-history@1": publish_history_schema.PublishHistory,
}


def parse_document(doc: dict[str, Any]) -> BaseModel:
    """Parse a content document with the model its ``schema`` field names.

    Raises ``KeyError`` for an unknown schema and ``pydantic.ValidationError`` for bad content.
    """
    tag = doc.get("schema")
    if not isinstance(tag, str) or tag not in DOCUMENT_MODELS:
        raise KeyError(f"unknown content schema: {tag!r}")
    return DOCUMENT_MODELS[tag].model_validate(doc)
