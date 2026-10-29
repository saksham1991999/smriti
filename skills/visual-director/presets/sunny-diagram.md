# Preset: sunny-diagram

**Use for:** Explanatory diagrams: a cell, a circuit, a pulley system, the water cycle, a map region.

| | |
|---|---|
| Size | 1536 × 1024. |
| Background | White or a very light tint, so labels overlaid by the app stay readable. |
| Composition | Parts arranged clearly with space around each labelled part. The areas at label_anchors are left empty. |

## Prompt

Start from the base prompt in `DESIGN.md` §6.2, then add:

```
a clear educational diagram of {brief}, accurate proportions, every part clearly separated, empty space reserved around {anchor_list}, no labels, no arrows with text
```

Then add the request's `must_show` items, its `must_not_show` items as negatives, the shared negative guidance from `DESIGN.md` §6.2, and the subject's colour family from `packages/tokens/tokens.json`.

## Extra review points

- [ ] Every part is correct against the source diagram named in the request.
- [ ] Directions (current, flow, force) match the brief.
- [ ] The label anchor areas are empty.

The shared review checklist in `../SKILL.md` always applies as well.
