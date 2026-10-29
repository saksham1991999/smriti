---
name: visual-director
description: Plan, generate and QA every Smriti illustration with Agnes AI - lesson visuals, diagrams, comics, mascots, the streak plant, badges, 360° scenes and UI art - following the Sunny Subjects style guide, reusing existing images from the image index first. Use whenever a media request of kind image, diagram, comic or pano360 is open, or new UI art is needed.
---

# visual-director

The only way illustrations enter Smriti. **Never draw illustrations yourself** (no hand-written SVG art, CSS or canvas drawings, and no code-made pictures). Every illustration is generated with Agnes AI from the presets in `DESIGN.md` §6.

Read `DESIGN.md` §6 (house style, presets, mascots, plant, delivery) and `skills/_shared/content-format.md` §11 first.

## Inputs

- Open requests in `content/media/requests/**` with `status: requested` and `kind` in `image`, `diagram`, `comic`, `pano360`.
- Or a UI art need (onboarding, empty states, badges, league crests, the pets, the plant).
- `AGNES_AI_API_KEY` in the environment, and network access to `apihub.agnes-ai.com`. If either is missing, stop and say which.

## The Agnes call

Use the AI gateway's image interface in app code. For one-off asset work outside the app (for example in a skill run before the gateway exists), call the API directly:

```bash
curl https://apihub.agnes-ai.com/v1/images/generations \
  -H "Authorization: Bearer $AGNES_AI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "agnes-image-2.1-flash", "prompt": "…", "size": "2K", "ratio": "1:1",
       "image": ["<reference sheet URL, for pets and the plant>"],
       "extra_body": {"response_format": "url"}}'
```

- `size` is `1K`, `2K`, `3K` or `4K`, and `ratio` is one of `1:1`, `3:4`, `4:3`, `16:9`, `9:16`, `2:3`, `3:2`, `21:9`. Each preset names the pair to use.
- The response is `{"data": [{"url": "…", "b64_json": null, "revised_prompt": null}]}`. Download the image straight away, because the returned URL is temporary storage, not ours.
- Allow 60–360 s per call. Run calls one at a time or in small batches.
- **Transparency:** Agnes returns opaque images. For presets marked transparent, prompt for "on a plain flat pure white background, no shadow on the background", then cut out the subject with `rembg` (MIT) and check the edges at 200% zoom.

## Steps

1. **Search before generating.** Query the image index (`content.media_assets`, by text embedding and tags) for an approved image that fits the brief. If one fits, set `result.reused = true` with its `sha256` and stop.
2. **Pick the preset** named in the request (`DESIGN.md` §6.2). If none is named, choose one and record it.
3. **Build the prompt** from `presets/{preset}.md`: the base prompt, the preset's additions, the request's `brief`, `must_show`, `must_not_show`, the subject's colour family, and the negative guidance. Leave the areas at `label_anchors` clear and free of text.
4. **Characters:** for the cat, the dog or the plant, always pass the approved reference sheet (or its seed or reference ID). If there is no approved reference sheet yet, generating one is the first job, and it needs a person's approval.
5. **Generate** through the AI gateway's image interface, not a direct SDK call, so cost, caching and tracing are recorded. Generate 2–4 candidates for important art.
6. **Review each candidate** against the checklist below. Regenerate with a corrected prompt when one fails, at most 3 rounds, then escalate to a person.
7. **Deliver:** upload the original to R2 staging, add the asset with its `prompt`, `prompt_hash`, `style_preset`, `model_version`, `tags`, `alt` (both languages), `licence: owned`, `source: agnes`. Set the request to `generated` with the `result`.
8. Diagrams go to `content-qa` for factual checks. Mascots, plant art and anything for under-10s need a person's approval.

## Presets

One file per preset in `presets/`, matching `DESIGN.md` §6.2: `sunny-object`, `sunny-scene`, `sunny-diagram`, `pet-cat`, `pet-dog`, `plant-stage`, `storybook`, `roleplay-portrait`, `memory-hook`, `pano-360`, `badge`, `league-tier`, `empty-state`. Each file has the size, background, composition notes, the additions to the base prompt and the review points specific to that preset.

## Special cases

- **Diagrams:** correct proportions and parts matter more than looks. Compare with the source diagram listed in the request. Arrows, labels and numbers are added by the app at the anchors, never generated.
- **Comics and storybooks:** generate panel by panel with the same characters, and keep the characters consistent with a reference image.
- **360° scenes:** 2:1 equirectangular, seamless at the left and right edges, the horizon level, no visible distortion at the poles. Check in the 360° viewer before approving.
- **Historical figures:** dress, setting and objects grounded in the period. Respectful. Not a photograph.
- **Interactive figures** (something a student drags or explores) are sims, not illustrations. Hand those to `sim-builder`.

## Review checklist (each image)

- [ ] Matches the house style: soft 3D, top-left light, subject colours, clean composition.
- [ ] Shows everything in `must_show` and nothing in `must_not_show`.
- [ ] **No text, letters, numbers or logos** anywhere, including on objects.
- [ ] Anatomy, hands, faces and objects are not distorted.
- [ ] Factually correct for diagrams (parts, proportions, directions).
- [ ] Indian context and diversity where people appear. Age-appropriate.
- [ ] Mascot or plant consistent with its reference sheet.
- [ ] Alt text in English and Hindi describes what matters for learning.
