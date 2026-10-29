---
name: lesson-author
description: Write Smriti's Deep Dive and Quick Revision lessons (typed card sequences) for a topic in English and Hindi, plus cheat sheets, storybooks, role plays and home experiments, using each subject's teaching style. Use after syllabus-mapper has created the topic's concepts.
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
- **Role play** script: character, era, documented views, goals, guardrails, opening line. The LLM plays the role at runtime from this script.
- **Experiment**: materials, steps, safety notes, "why it works".

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
- [ ] `pnpm content:check` passes.
