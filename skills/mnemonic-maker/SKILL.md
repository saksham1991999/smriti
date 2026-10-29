---
name: mnemonic-maker
description: Create and collect memory aids for Smriti concepts - acronyms, acrostics, rhymes, songs, stories, keyword images, PAO scenes, major-system words, peg and memory-palace scripts - in English and Hindi, with image and audio requests. Use for every list, date, sequence, constant, exception and confusable pair in a chapter.
---

# mnemonic-maker

Writes `content/mnemonics/{subject}/{chapter}.json` and the matching media and audio requests. These feed memory-hook cards, the technique library and the community pool. The runtime "Make it stick" forge (PRD §5.4) uses the same techniques and these files as examples. Read `skills/_shared/content-format.md` §10.

## What needs a mnemonic

Go through the chapter's concepts and inventory, and make a hook for every:
- ordered list (planets, the reactivity series, the order of the Preamble's words),
- unordered set students must recall in full (fundamental duties, the noble gases),
- date and number (years, constants, article and section numbers),
- exception to a rule,
- pair or group that students confuse.

## Techniques and when to use them

| Technique | Best for | Notes |
|---|---|---|
| `acronym` / `acrostic` | Ordered lists | The classic first-letter hooks. Collect the well-known traditional ones first (`origin: traditional`). |
| `rhyme` / `song` | Lists and rules for younger students and audio learners | Request Deepgram TTS audio. Songs get a simple, original melody brief. |
| `story` | Unordered sets and processes | A short, vivid, slightly absurd chain with cause and effect |
| `keyword` | Vocabulary, foreign terms, legal definitions | A sounds-like bridge word plus an image request |
| `pao` | Three linked data points (person, action, object) | One vivid scene |
| `major_system` | Numbers: constants, dates, article numbers | Digits → consonant sounds → a word → an image |
| `peg` | Numbered lists | Uses the app's illustrated peg set (1 = bun, 2 = shoe, …) |
| `palace` | Long ordered lists and timelines | A walk through a preset room (home, school, a monument) with one item per spot |
| `chunking` | Long strings of numbers or items | Groups of 3–5 with a label for each group |
| `visual` | Shapes, structures, trends | A single memorable image request |

## Style by exam

The forge is course-aware, so these files should be too (`exam_style`):
- **JEE and NEET:** quick, punchy, formula-friendly, a little nerdy humour.
- **UPSC:** story and palace methods for history, polity articles and schedules. Calm and precise.
- **SSC:** short rhymes and acronyms for static GK and rules.
- **Class 1–5:** songs, rhymes and pictures only.

## Steps

1. List the hook-worthy items for the chapter (above).
2. For each, look for a **traditional** mnemonic first, and record where it's commonly taught. Keep both the English and Hindi traditional versions when they differ.
3. Create a **system** mnemonic where none exists, or where the traditional one is weak or wrong.
4. Fill `decodes_to` with the exact items, in order.
5. Request an image (`memory-hook` preset) for visual techniques, and audio (`audio_tts` or `audio_song`) for rhymes and songs.
6. Run the checks below.

## Rules

- **Accuracy first:** the decoded items must exactly match the facts, in order, including spelling. A catchy but wrong mnemonic is a bug.
- Hindi mnemonics are made for Hindi, not translated. Make separate items per locale.
- Nothing offensive, nothing about real private people, no stereotypes.
- Don't overload: at most two techniques per item, so students aren't confused.

## Checklist

- [ ] Every list, date, sequence, exception and confusable pair has at least one hook.
- [ ] `decodes_to` verified against the source for every item.
- [ ] Traditional mnemonics cite where they're commonly taught.
- [ ] Image and audio requests added where the technique needs them.
- [ ] `pnpm content:check` passes.
