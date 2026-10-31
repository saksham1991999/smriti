---
name: lesson-author
description: Write Smriti's Deep Dive and Quick Revision lessons (typed card sequences) for a topic in English and Hindi, plus cheat sheets, storybooks, songs and play activities for class 1–5, role plays and home experiments, using each subject's teaching style. Use after syllabus-mapper has created the topic's concepts.
---

# lesson-author

Writes `content/lessons/{subject}/{chapter}/{topic}.deep_dive.json` and `.quick_revision.json`, and the topic's extras. Read first:
- `skills/_shared/content-format.md` §7 (card types) and §11 (media requests)
- `skills/_shared/quality-bar.md`
- PRD §5.1–5.3 (modes, cards, subject styles)

## Inputs

- The topic ID. Its concepts, key points, depths and prerequisites from `content/graph/`.
- Every exam map that uses those concepts, to know the deepest level needed.
- The chapter inventory in `content/coverage/` (everything that must be taught).
- Sources: NCERT and the references listed in the chapter's `sources`.

## Deep Dive

Split the topic into **bites** of 2–4 minutes (one per subtopic or a part of one). Each bite follows this arc, skipping steps that don't fit:

1. **Hook** (`story`): a relatable Indian scenario, a puzzle or a surprising question.
2. **Intuition** (`explainer`): the idea in plain words, with a visual request.
3. **See it** (`animation`, `sim`, `model3d` or `pano360`): the moving or explorable version, if one helps.
4. **Try it** (`interactive` or `question`): retrieval before more telling.
5. **Formalise** (`derivation` or `worked_example`): every formula derived or justified, symbols and units explained.
6. **Check** (`question`): 1–3 questions at rising depth.
7. **Remember** (`memory_hook`): for lists, dates, constants, sequences and exceptions.
8. **Summary** (`summary`): the bite's key points. These become spaced-repetition cards.

Tag every card with `depth`. Put L4–L5 material in its own cards (for example "Going further"), so lower-depth exams skip them cleanly.

## Quick Revision

2–5 minutes for the whole topic:
- One `cheat_sheet_ref` (write the sheet in `extras/`): key formulas, definitions, a mini diagram request, mnemonics.
- 5–10 rapid `question` or `summary` cards on the highest-yield points.
- One "common traps" card listing the mistakes students make, each with the correct idea.

## Subject styles

| Subject | Lean on |
|---|---|
| Physics | Sims, gyroscope demos, derivations, worked examples, a home experiment per chapter where safe |
| Chemistry | 3D molecules, the periodic table, reaction animations, mnemonics for trends and exceptions |
| Biology | Labelled diagrams, 3D anatomy, process animations, NCERT-line recall cards, 360° cell or ecosystem trips |
| Maths | Visual proofs, graph widgets, stepwise derivations, "trick vs method" worked examples |
| History | `roleplay` with a historical figure, comic-strip `story` cards, timelines, a memory palace for dates |
| Geography | Map widgets, `pano360` landforms, map-pinning `interactive` cards |
| Polity and economy | Analogies, flowcharts, case-style `story` cards, mock-parliament role play |
| Reasoning and quant | Pattern cards, shortcut worked examples, timed question ladders |
| Class 1–5 | Storybooks, rhymes, the pet as narrator, big visuals, very short text |

Parody and humour (spoof news, meme recaps) can appear as `story` cards when they clarify, never at anyone's expense.

## Extras (in `extras/`)

- **Cheat sheet** and **revision sheet** for every topic and chapter (these also feed the PDF book export).
- **Storybook** for class 1–8 topics and history: 6–12 pages, each with text and an illustration request.
- **Song** and **play activity** for class 1–5 topics (see "Little learners" below).
- **Role play** script: character, era, documented views, goals, guardrails, opening line. The LLM plays the role at runtime from this script.
- **Experiment**: materials, steps, safety notes, "why it works".

## Little learners (class 1–5)

Little learner exam profiles (`audience: "little_learner"`) need, for every concept, a **teaching item** (a Deep Dive teaching card, a storybook or a song) and a **play activity** (`play_activity`). They have no Quick Revision, practice sets or formula requirements. A song also counts as the concept's memory hook in each language it is sung in. Write them in `extras/{subject}/{chapter}/`, scoped to a topic (or a chapter: it then sits on the chapter's first topic in the app's path).

Every word a child hears is gentle. Never use "wrong", "incorrect", "fail", "mistake", "not quite", "bad", "oops", "try harder", गलत, असफल, फेल, नाकाम or ठीक नहीं in feedback, prompts or hints (the content check refuses them in `play@1`; the full list is `NEGATIVE_FEEDBACK_WORDS` in `packages/content-schema`). Use तुम in Hindi. Keep text very short; audio carries the meaning.

**Storybook** (`storybook@1`, id `sb.{topic or chapter}`): 6–12 pages, each `{ text, media, narration? }`. One short paragraph per page for class 1–2, at most three for class 3–5. Each page's `media` is an image request with the `storybook` preset; `narration` is an `audio_tts` request per locale (audio-maker). Give it a `title` the pet can read aloud on the path.

**Song** (`song@1`, id `sg.{topic or chapter}`): a rhyme, song or chant that carries the concept.

```json
{
  "schema": "song@1", "id": "sg.{topic}", "scope": "topic", "topic": "{topic}",
  "title": { "en": "…", "hi": "…" }, "concepts": ["…"],
  "style": "rhyme", "minutes": 1, "cover": "img.{chapter}.{slug}",
  "actions": [{ "id": "clap", "cue": { "en": "Clap!", "hi": "ताली!" }, "icon": "HandsClapping" }],
  "versions": [
    { "locale": "en", "audio": "audio.{chapter}.{slug}-en",
      "lines": [{ "text": "…" }, { "text": "…", "action": "clap" }] },
    { "locale": "hi", "audio": "audio.{chapter}.{slug}-hi", "lines": [{ "text": "…" }] }
  ]
}
```

- `style`: `song`, `rhyme` or `chant`. `minutes` at most 10. `cover` is a `sunny-object` or `storybook` image request (the path node thumbnail).
- **One version per locale, written for that language**, not translated line by line: Hindi rhymes rhyme in Hindi. Facts stay identical. Up to 40 short lines per version.
- Each version's `audio` is its own `audio_song` request in that locale, with a `transcript` holding the lyrics (the check refuses a song without one). audio-maker produces it.
- `actions` (up to 8) are things to do while singing: `cue` is spoken text, `icon` a Phosphor icon name (PascalCase) from the app's icon set, `iconNames` in `packages/tokens/src/ui/icons.ts` (the check refuses any other name with `icon_unknown`, so nothing falls back to a placeholder icon). To use a new Phosphor icon, add it there and to both `iconMap`s in `ui-web` and `ui-native` in the same pull request. A line names an action with `action`.
- Leave `start_ms`/`end_ms` out when writing. audio-maker adds them to every line from the generated audio (all lines or none; they run forward and end within the audio).
- Popular traditional rhymes may be used only when out of copyright or openly licensed; record the source in `sources`. Prefer original rhymes.

**Play activity** (`play@1`, id `pl.{topic or chapter}`): 1–6 short rounds, about a minute each. There is no score, timer or fail state. The player bounces a wrong move with `feedback.try_again`, shows the round's `hint` after the second wrong move, then shows the move so the child still finishes it (every round ends on a win).

```json
{
  "schema": "play@1", "id": "pl.{topic}", "scope": "topic", "topic": "{topic}",
  "title": { "en": "…", "hi": "…" }, "concepts": ["…"], "minutes": 2, "cover": "img.{chapter}.{slug}",
  "feedback": { "success": { "en": "…", "hi": "…" }, "try_again": { "en": "…", "hi": "…" } },
  "rounds": [
    { "kind": "tap", "prompt": {…}, "hint": {…}, "items": [{ "id": "apple", "label": {…}, "media": "img.…" }], "answer": ["apple"] },
    { "kind": "match", "prompt": {…}, "pairs": [{ "left": {tile}, "right": {tile} }] },
    { "kind": "sort", "prompt": {…}, "buckets": [{ "id": "living", "label": {…} }], "items": [{ "id": "dog", "label": {…}, "media": "img.…", "bucket": "living" }] },
    { "kind": "drag", "prompt": {…}, "scene": "img.…", "targets": [{ "id": "nest", "label": {…}, "x": 0.3, "y": 0.4, "radius": 0.12, "accepts": "bird" }], "items": [{tile}] },
    { "kind": "trace", "prompt": {…}, "glyph": "क", "script": "devanagari", "guide": "anim.{chapter}.{slug}", "min_coverage": 0.7 }
  ]
}
```

| Round | Child does | Rules |
|---|---|---|
| `tap` | Taps every picture that fits ("Tap the red fruits") | 2–6 `items`, `answer` lists the right ids (not all of them) |
| `match` | Joins each left picture to its partner | 2–5 `pairs`, tile ids unique in the round |
| `sort` | Puts each picture in its basket | 2–3 `buckets`, 2–8 `items`, each with a `bucket` that exists; every bucket gets an item |
| `drag` | Drags pictures onto places in a scene | 1–5 `targets` (centre `x`, `y` and `radius` as 0–1 of the scene; make radii generous, 0.1 or more), each `accepts` one item; extra items are gentle distractors |
| `trace` | Traces a letter or digit | `glyph` 1–3 characters, `script` `latin`, `devanagari` or `digits`; `min_coverage` 0.5–0.95 |

- Every round has a spoken `prompt`, and may have a `hint` and a per-locale `audio` prompt (`audio_tts`). Tiles are pictures with a spoken `label`: one `sunny-object` image request each, never text in the image.
- **Trace never uses drawn paths.** The app draws the glyph from its own font. `guide` is a stroke-order animation request for anim-maker (Rive), with a transcript.
- `feedback` lines are short and warm, in तुम ("Yay! You did it!" / "वाह! तुमने कर दिखाया!" is the tone).

## Media

Request, don't describe. For every visual, add an entry in `content/media/requests/{subject}/{chapter}.json` with a preset from `DESIGN.md` §6.2, a precise brief, `must_show`, label anchors and alt text in both languages. `visual-director`, `anim-maker`, `sim-builder` and `model-3d-sourcer` fulfil them.

## Rules

- Every inventory item for the topic is taught somewhere in the Deep Dive and revised in Quick Revision.
- One idea per card. At most 3 short paragraphs of body text.
- Both languages, written naturally, with identical facts and card order.
- Cite sources at file level, and add a card-level `source` for any specific number, date or quotation.
- Don't write questions inline. Write them with `question-author` and reference them by ID.

## Checklist

- [ ] Every concept in the topic has a teaching card and a summary point.
- [ ] Every formula has a derivation or justification, its symbols and units, and a worked example.
- [ ] Every list, date or sequence has a memory hook.
- [ ] Every explainer has a media request with alt text.
- [ ] Depth tags make sense for every exam that uses these concepts.
- [ ] `estimated_minutes` is realistic (about 20–30 seconds per text card, longer for sims).
- [ ] Little learner profiles: every concept has a storybook, song or teaching card, and a play activity.
- [ ] Songs: one version per locale, each with its own `audio_song` request and transcript.
- [ ] Play: no negative words; every id a round names exists.
- [ ] `pnpm content:check` passes.
