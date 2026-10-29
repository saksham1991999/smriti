# Preset: plant-stage

**Use for:** The streak plant: 5 growth stages × 5 health states (DESIGN.md §6.4).

| | |
|---|---|
| Size | 1024 × 1024 |
| Background | Transparent. |
| Composition | The same terracotta pot, the same camera angle and the same scale in all 25 images, so they cross-fade cleanly. |

## Prompt

Start from the base prompt in `DESIGN.md` §6.2, then add:

```
the Smriti streak plant, a tulsi-like herb in the reference terracotta pot, growth stage {stage}, health {health}, same camera and scale as the reference
```

Then add the request's `must_show` items, its `must_not_show` items as negatives, the shared negative guidance from `DESIGN.md` §6.2, and the subject's colour family from `packages/tokens/tokens.json`.

## Extra review points

- [ ] Pot, angle and scale identical to the reference (overlay to check).
- [ ] Dormant shows bare stems with one bud, resting, never dead.

The shared review checklist in `../SKILL.md` always applies as well.
