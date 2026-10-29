# Preset: league-tier

**Use for:** Weekly league crests (one per tier).

| | |
|---|---|
| Agnes size and ratio | `1K`, `1:1`. Delivered at 512 × 512. |
| Background | Transparent. |
| Composition | A crest whose material and colour step up with the tier, all in one family. |

## Prompt

Start from the base prompt in `DESIGN.md` §6.2, then add:

```
a league crest for tier {tier_name}, {material} finish, part of a consistent set of ten crests, centred
```

Then add the request's `must_show` items, its `must_not_show` items as negatives, the shared negative guidance from `DESIGN.md` §6.2, and the subject's colour family from `packages/tokens/tokens.json`.

## Extra review points

- [ ] Clearly ranks against its neighbours in the set.
- [ ] Consistent shape across all tiers.

The shared review checklist in `../SKILL.md` always applies as well.
