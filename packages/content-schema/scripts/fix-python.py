"""Post-process the generated Pydantic models.

datamodel-code-generator merges a base ``pattern`` into fields that a branch narrows to a
``const``, giving ``Annotated[Literal["x@1"], Field(pattern=...)]``. Pydantic cannot use such a
field as a union discriminator, and the pattern adds nothing once the value is a literal, so it
is dropped here.

Usage: python3 scripts/fix-python.py <models dir>
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

LITERAL_WITH_PATTERN = re.compile(
    r"(Literal\[[^\]]+\],\s*Field\([^()]*?),\s*pattern=\"[^\"]*\"",
)


def main(folder: str) -> None:
    for path in sorted(Path(folder).glob("*.py")):
        text = path.read_text(encoding="utf-8")
        fixed = LITERAL_WITH_PATTERN.sub(r"\1", text)
        if fixed != text:
            path.write_text(fixed, encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1])
