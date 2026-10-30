#!/usr/bin/env bash
# Generates the Pydantic v2 models in python/smriti_content/models/ from the JSON Schemas.
# Usage: pnpm --filter @smriti/content-schema gen:python   (needs uv)
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
out="$here/python/smriti_content/models"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

uvx --from datamodel-code-generator==0.83.0 datamodel-codegen \
  --input "$here/schemas" \
  --input-file-type jsonschema \
  --output "$tmp/models" \
  --output-model-type pydantic_v2.BaseModel \
  --target-python-version 3.12 \
  --use-annotated \
  --field-constraints \
  --use-standard-collections \
  --use-union-operator \
  --use-type-alias \
  --use-double-quotes \
  --use-schema-description \
  --use-title-as-name \
  --capitalise-enum-members \
  --enum-field-as-literal all \
  --disable-timestamp \
  --custom-file-header "# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit."

python3 "$here/scripts/fix-python.py" "$tmp/models"
rm -rf "$out"
mv "$tmp/models" "$out"
touch "$out/__init__.py"
echo "wrote $out"
