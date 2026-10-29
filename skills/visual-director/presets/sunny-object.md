# Preset: sunny-object

**Use for:** Subject icons, topic tiles, chapter art, and single objects inside lessons.

| | |
|---|---|
| Agnes size and ratio | `2K`, `1:1`. Delivered at 1024 × 1024. |
| Background | Transparent. |
| Composition | One object, centred, three-quarter view, about 70% of the frame, generous padding, a soft contact shadow under it. |

## Prompt

Start from the base prompt in `DESIGN.md` §6.2, then add:

```
a single {object}, three-quarter view, isolated on a transparent background
```

Then add the request's `must_show` items, its `must_not_show` items as negatives, the shared negative guidance from `DESIGN.md` §6.2, and the subject's colour family from `packages/tokens/tokens.json`.

## Extra review points

- [ ] Reads clearly at 48 px (check a downscaled copy).
- [ ] The silhouette is distinct from the other subject icons.

The shared review checklist in `../SKILL.md` always applies as well.
