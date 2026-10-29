# Preset: sunny-scene

**Use for:** Lesson hero images, onboarding screens and story beats.

| | |
|---|---|
| Size | 1536 × 1024 (3:2). The app crops to 16:9 and 4:3, so keep the subject inside the central 70%. |
| Background | A soft gradient in the subject's tint colour, with simple rounded scenery. |
| Composition | One clear focal point, a simple foreground and background, people (if any) shown from the waist up or full figure at a small scale. |

## Prompt

Start from the base prompt in `DESIGN.md` §6.2, then add:

```
a simple scene showing {brief}, soft gradient background in {tint_colour}, rounded simplified scenery
```

Then add the request's `must_show` items, its `must_not_show` items as negatives, the shared negative guidance from `DESIGN.md` §6.2, and the subject's colour family from `packages/tokens/tokens.json`.

## Extra review points

- [ ] The focal point survives a 16:9 and a 4:3 crop.
- [ ] No clutter: at most 5 distinct objects.

The shared review checklist in `../SKILL.md` always applies as well.
