# Preset: pano-360

**Use for:** Phone-based 360° field trips: monuments, the solar system, inside a cell, ecosystems.

| | |
|---|---|
| Size | 4096 × 2048 equirectangular (2:1). |
| Background | The full scene. |
| Composition | Horizon on the vertical centre line. Key points of interest spread around the full 360°. Calm areas at the zenith and nadir. |

## Prompt

Start from the base prompt in `DESIGN.md` §6.2, then add:

```
a 360-degree equirectangular panorama of {scene}, seamless left and right edges, level horizon, soft 3D illustration style
```

Then add the request's `must_show` items, its `must_not_show` items as negatives, the shared negative guidance from `DESIGN.md` §6.2, and the subject's colour family from `packages/tokens/tokens.json`.

## Extra review points

- [ ] The left and right edges join seamlessly in the 360° viewer.
- [ ] No stretching artefacts at the top and bottom.
- [ ] Hotspot locations in the request show the right objects.

The shared review checklist in `../SKILL.md` always applies as well.
