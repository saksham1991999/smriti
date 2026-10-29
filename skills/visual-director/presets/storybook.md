# Preset: storybook

**Use for:** Storybook pages and comic-strip panels for class 1–8 and history.

| | |
|---|---|
| Agnes size and ratio | `2K`, `3:2`. Delivered at 1536 × 1024 per page or panel. |
| Background | A full scene in a flatter 2.5D storybook finish. |
| Composition | Keep the bottom 25% calm and simple: the app places the text there. |

## Prompt

Start from the base prompt in `DESIGN.md` §6.2, then add:

```
a storybook illustration in a soft 2.5D style of {brief}, warm friendly colours, consistent characters from the reference
```

Then add the request's `must_show` items, its `must_not_show` items as negatives, the shared negative guidance from `DESIGN.md` §6.2, and the subject's colour family from `packages/tokens/tokens.json`.

## Extra review points

- [ ] Characters stay consistent from panel to panel.
- [ ] The bottom 25% is calm enough for overlaid text.

The shared review checklist in `../SKILL.md` always applies as well.
