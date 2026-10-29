# Preset: pet-cat

**Use for:** The cat mascot in any pose or mood.

| | |
|---|---|
| Size | 1024 × 1024 |
| Background | Transparent. |
| Composition | Full body unless the request says portrait. Leave room above the head for speech bubbles. |

## Prompt

Start from the base prompt in `DESIGN.md` §6.2, then add:

```
the Smriti cat mascot (small, round, cream-and-orange, big friendly eyes, gold tail tip), {pose}, {mood} expression, consistent with the reference sheet
```

Then add the request's `must_show` items, its `must_not_show` items as negatives, the shared negative guidance from `DESIGN.md` §6.2, and the subject's colour family from `packages/tokens/tokens.json`.

## Extra review points

- [ ] Matches the approved reference sheet: colours, proportions, eye shape, tail tip.
- [ ] Sad, tired or unwell moods are gentle (a blanket, a basket, a sigh), never distress or injury.

The shared review checklist in `../SKILL.md` always applies as well.
