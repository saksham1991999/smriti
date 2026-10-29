# Preset: badge

**Use for:** Achievement badges.

| | |
|---|---|
| Agnes size and ratio | `1K`, `1:1`. Delivered at 512 × 512. |
| Background | Transparent. |
| Composition | A centred emblem with a simple frame, readable at 64 px. |

## Prompt

Start from the base prompt in `DESIGN.md` §6.2, then add:

```
a shiny soft-3D achievement badge emblem showing {symbol}, simple rounded frame, centred
```

Then add the request's `must_show` items, its `must_not_show` items as negatives, the shared negative guidance from `DESIGN.md` §6.2, and the subject's colour family from `packages/tokens/tokens.json`.

## Extra review points

- [ ] Readable at 64 px.
- [ ] Distinct from the other badges in the same set.

The shared review checklist in `../SKILL.md` always applies as well.
