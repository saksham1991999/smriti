---
name: audio-maker
description: Produce Smriti's audio with Deepgram text-to-speech - lesson narration, audio mnemonics, rhymes and chants, pet voice lines - in English and Hindi, cached in R2 and listed in bundles. Use when a media request of kind audio_tts or audio_song is open.
---

# audio-maker

Audio supports audio-first learners and visually impaired students (PRD §5.4), and narrates lessons for younger classes. Text-to-speech goes through Deepgram via the AI gateway's `SpeechProvider` (TRD §9.4).

## Inputs

- Requests in `content/media/requests/**` with `kind: audio_tts` (narration, read-aloud, pet lines) or `kind: audio_song` (rhymes and chants).
- The text, from the card or mnemonic the request belongs to, in its locale.
- `DEEPGRAM_API_KEY` in the environment. If it's missing, stop and say so.

## Voices

- One narrator voice per locale, chosen in Phase 0 (TRD decision D3) and recorded in `skills/audio-maker/voices.json` once picked.
- If a good Hindi voice isn't available from Deepgram, the Phase 0 decision names the Hindi fallback provider. Use whatever `voices.json` says, never a hard-coded voice.

## Steps

1. **Prepare the script.** Write out numbers, units, symbols and abbreviations the way they should be spoken in that language (for example a formula read as words). Keep the on-screen text unchanged.
2. **Check the cache.** The key is `sha256(script + voice + locale + speed)`. If an approved asset exists, reuse it.
3. **Generate** through the gateway. For rhymes and chants, use a slower, rhythmic delivery (short lines, a pause at each line end).
4. **Backing loops** for rhymes may come only from CC0 or royalty-free libraries, with the licence recorded. Original sung melodies are out of scope until the owner picks a music provider.
5. **Post-process:** trim silence, normalise loudness to −16 LUFS, encode to AAC or Opus at 64 kbps mono for speech.
6. **Register** the asset (`source: deepgram_tts`, the script in `prompt`, the cache key in `prompt_hash`) and set the request's `result`. Every audio asset has its script stored as the caption or transcript.

## Checklist

- [ ] Pronunciation checked for technical terms, names and numbers in both languages.
- [ ] The script matches the on-screen text in meaning.
- [ ] Loudness normalised. File under 100 KB per 10 s of speech.
- [ ] Transcript or caption stored with the asset.
- [ ] Any backing loop is CC0 or royalty-free, with the licence recorded.
