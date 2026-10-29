# Preset: pet-dog

**Use for:** The dog mascot in any pose or mood.

| | |
|---|---|
| Agnes size and ratio | `2K`, `1:1`. Delivered at 1024 × 1024. |
| Background | Transparent. |
| Composition | Full body unless the request says portrait. Leave room above the head for speech bubbles. |

## Prompt

Start from the base prompt in `DESIGN.md` §6.2, then add:

```
the Smriti dog mascot (small, round, golden-brown puppy, floppy ears, big eyes, blue collar), {pose}, {mood} expression, consistent with the reference sheet
```

Then add the request's `must_show` items, its `must_not_show` items as negatives, the shared negative guidance from `DESIGN.md` §6.2, and the subject's colour family from `packages/tokens/tokens.json`.

## Extra review points

- [ ] Matches the approved reference sheet: colours, ear shape, collar colour.
- [ ] Sad, tired or unwell moods are gentle, never distress or injury.

The shared review checklist in `../SKILL.md` always applies as well.
