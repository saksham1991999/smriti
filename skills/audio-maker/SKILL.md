---
name: audio-maker
description: Produce Smriti's audio with Deepgram Flux text-to-speech (v2) - lesson narration, audio mnemonics, rhymes and chants, pet voice lines - in English and Hindi, cached in R2 and listed in bundles. Use when a media request of kind audio_tts or audio_song is open.
---

# audio-maker

Audio supports audio-first learners and visually impaired students (PRD §5.4), and narrates lessons for younger classes. Text-to-speech goes through Deepgram Flux TTS on the v2 API (`POST https://api.deepgram.com/v2/speak`) via the AI gateway's `SpeechProvider` (TRD §9.4), for both English and Hindi. Never call Deepgram directly from a script or feature.

## Inputs

- Requests in `content/media/requests/**` with `kind: audio_tts` (narration, read-aloud, pet lines, play prompts) or `kind: audio_song` (rhymes, chants, mnemonic songs and little learner songs).
- The text, from the card, mnemonic, storybook, play round or song the request belongs to, in its locale. For a `song@1` (written by lesson-author), the lyrics are the `lines` of the version whose `audio` is this request.
- `DEEPGRAM_API_KEY` in the environment. If it's missing, stop and say so.

## Voices

- Flux voice ids have the form `flux-<name>-<lang>` and are sent as the `model` query parameter: `-hi` voices for Hindi, `-en` voices for English. Deepgram lists 14 Hindi Flux voices and 3 Indian-accent English voices (meena, naveen, priya); the full list is in Deepgram's Flux voices page.
- The Hindi voices were checked on 31 Oct 2026 by reading samples back with Deepgram speech-to-text in Hindi (samples and notes in the project files, `smriti/voice-samples/flux/`). No separate Hindi provider is needed.
- One narrator voice per locale, picked by the owner (TRD decision D3) and recorded in `skills/audio-maker/voices.json`. That file doesn't exist yet: until the owner picks, stop and say so rather than choosing a voice.
- Use whatever `voices.json` says. Never hard-code a voice or model id in a skill, script or code; the gateway takes the voice id as data and its own model settings from config.

## Steps

1. **Prepare the script.** Write out numbers, units, symbols and abbreviations the way they should be spoken in that language (for example a formula read as words). Keep the on-screen text unchanged.
2. **Check the cache.** The key is `sha256(script + voice + locale + speed)`. If an approved asset exists, reuse it.
3. **Generate** through the gateway (Flux TTS, v2), with the locale's voice from `voices.json`. For rhymes and chants, use a slower, rhythmic delivery (short lines, a pause at each line end).
4. **Backing loops** for rhymes may come only from CC0 or royalty-free libraries, with the licence recorded. Original sung melodies are out of scope until the owner picks a music provider.
5. **Post-process:** trim silence, normalise loudness to −16 LUFS, encode to AAC or Opus at 64 kbps mono for speech.
6. **Register** the asset (`source: deepgram_tts`, the script in `prompt`, the cache key in `prompt_hash`) and set the request's `result`. Every audio asset has its script stored as the caption or transcript.

## Songs for little learners (`song@1`)

Each song version is sung (spoken rhythmically) in its own language through the same Deepgram path; there is no translation step and no separate song skill.

1. **One request per version.** The version's `audio` names an `audio_song` request with that version's `locale` and a `transcript` holding the lyrics. Don't reuse one language's audio for another.
2. **Generate line by line.** Synthesise each line with the rhythmic delivery above, then join them with a short pause at each line end (and an optional CC0 or royalty-free backing loop under the whole track). Keep lines in the version's order.
3. **Write the line timings** back into the song file: for each line, `start_ms` and `end_ms` are where that line's audio sits in the joined track. Every line gets both (or none), they run forward, and the last `end_ms` is within the track. If a track was made in one piece instead, align the lyrics with Deepgram speech-to-text word timestamps through the gateway and take each line's first and last word.
4. **Set `result.duration_ms`** to the track length; the content check refuses a line that ends after it, and warns when an approved song has no timings (the app then shows the lyrics without the moving highlight).
5. Child voice lines stay calm and slow: no shouting effects, no sudden loud sounds, loudness as above.

## Checklist

- [ ] Pronunciation checked for technical terms, names and numbers in both languages.
- [ ] The script matches the on-screen text in meaning.
- [ ] Loudness normalised. File under 100 KB per 10 s of speech.
- [ ] Transcript or caption stored with the asset.
- [ ] Any backing loop is CC0 or royalty-free, with the licence recorded.
- [ ] Songs: every line of every version has `start_ms` and `end_ms` within `result.duration_ms`.
