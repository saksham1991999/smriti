# Preset: empty-state

**Use for:** Empty, error and offline states (UX_FLOW §5).

| | |
|---|---|
| Size | 1024 × 768 |
| Background | Transparent. |
| Composition | The pet or plant in a gentle situation, with space above for one line of text. |

## Prompt

Start from the base prompt in `DESIGN.md` §6.2, then add:

```
the Smriti {pet_or_plant} {situation}, gentle and reassuring mood, consistent with the reference sheet
```

Then add the request's `must_show` items, its `must_not_show` items as negatives, the shared negative guidance from `DESIGN.md` §6.2, and the subject's colour family from `packages/tokens/tokens.json`.

## Extra review points

- [ ] Reassuring, never sad in a way that would upset a child.
- [ ] Consistent with the character reference.

The shared review checklist in `../SKILL.md` always applies as well.
