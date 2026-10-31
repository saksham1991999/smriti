"""Deep links and guardian links come from config, not a hard-coded domain."""

from __future__ import annotations

import json

from smriti_api.core.config import REPO_ROOT
from smriti_api.integrations.settings import IntegrationSettings
from smriti_api.services.app_config import deep_link_prefix, load_variant_files

VARIANTS = REPO_ROOT / "packages" / "config" / "variants"


def test_variant_deep_links_use_the_brand_domain() -> None:
    domain = json.loads((VARIANTS.parent / "brand.json").read_text())["domain"]
    files = load_variant_files(str(VARIANTS))
    assert files["all"]["deepLinkPrefix"] == f"https://{domain}"
    assert files["jee"]["deepLinkPrefix"] == f"https://{domain}/jee"
    assert deep_link_prefix("/ssc", "example.org") == "https://example.org/ssc"


def test_guardian_links_follow_the_web_app() -> None:
    assert (
        IntegrationSettings(web_app_url="https://app.example.org/").guardian_link_base
        == "https://app.example.org/guardian/"
    )
    explicit = IntegrationSettings(
        web_app_url="https://app.example.org", guardian_link_base_url="https://g.example.org/x/"
    )
    assert explicit.guardian_link_base == "https://g.example.org/x/"
    assert IntegrationSettings(web_app_url="").guardian_link_base.endswith("/guardian/")
