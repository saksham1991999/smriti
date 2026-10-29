# Preset: roleplay-portrait

**Use for:** Historical and fictional characters for role-play cards.

| | |
|---|---|
| Size | 1024 × 1024 |
| Background | A simple period-appropriate backdrop. |
| Composition | Head and shoulders, three-quarter view, a friendly neutral expression. |

## Prompt

Start from the base prompt in `DESIGN.md` §6.2, then add:

```
a respectful illustrated portrait of {character} as described in historical sources: {period_details}, soft 3D illustration style, not a photograph
```

Then add the request's `must_show` items, its `must_not_show` items as negatives, the shared negative guidance from `DESIGN.md` §6.2, and the subject's colour family from `packages/tokens/tokens.json`.

## Extra review points

- [ ] Dress, setting and objects fit the period (check against the request's source).
- [ ] Respectful, not a caricature.

The shared review checklist in `../SKILL.md` always applies as well.
