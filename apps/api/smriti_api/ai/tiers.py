"""Model tiers come from env (``AI_TIER_*_MODEL``), never from code (TRD §9.1, AGENTS.md rule 4)."""

from __future__ import annotations

from dataclasses import dataclass

from smriti_api.ai.interfaces import AIConfigError, Tier
from smriti_api.core.config import Settings


@dataclass(frozen=True)
class ModelTiers:
    tutor: str
    cheap: str
    author: str
    image: str
    # Photo doubt (tutor-social §A10): reads a question from a photo (AI-18).
    vision: str = ""

    @classmethod
    def from_settings(cls, settings: Settings) -> ModelTiers:
        return cls(
            tutor=settings.ai_tier_tutor_model,
            cheap=settings.ai_tier_cheap_model,
            author=settings.ai_tier_author_model,
            image=settings.ai_tier_image_model,
            vision=settings.ai_tier_vision_model,
        )

    def for_tier(self, tier: Tier) -> str:
        model = {
            "tutor": self.tutor,
            "cheap": self.cheap,
            "author": self.author,
            "vision": self.vision,
        }[tier]
        if not model:
            raise AIConfigError(f"AI_TIER_{tier.upper()}_MODEL is not set")
        return model

    def image_model(self) -> str:
        if not self.image:
            raise AIConfigError("AI_TIER_IMAGE_MODEL is not set")
        return self.image
