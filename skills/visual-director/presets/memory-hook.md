# Preset: memory-hook

**Use for:** Vivid images for mnemonics: keyword images, PAO scenes, story chains, peg images.

| | |
|---|---|
| Agnes size and ratio | `2K`, `1:1`. Delivered at 1024 × 1024. |
| Background | A soft tint gradient. |
| Composition | One clear, memorable, slightly absurd scene. Exaggeration helps memory. |

## Prompt

Start from the base prompt in `DESIGN.md` §6.2, then add:

```
a vivid, funny, memorable scene of {scene}, exaggerated scale and action, one clear focal point
```

Then add the request's `must_show` items, its `must_not_show` items as negatives, the shared negative guidance from `DESIGN.md` §6.2, and the subject's colour family from `packages/tokens/tokens.json`.

## Extra review points

- [ ] The image actually shows the mnemonic's link (a reviewer can say the fact from it).
- [ ] Funny without being mean or scary.

The shared review checklist in `../SKILL.md` always applies as well.
