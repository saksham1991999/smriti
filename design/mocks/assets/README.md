# Mock illustration kit

Draft art for the UI mocks in `design/mocks/`. It replaces the Fluent emoji stand-ins on the mock screens.

## Status

- **Draft, mock use only.** Nothing here is approved for the product.
- **The mascots are not approved.** DESIGN.md §6.3 asks for a reference sheet per pet (front, three-quarter, side, swatches) and the owner's approval before any other pet art. That has not happened yet. `cat-base.webp` and `dog-base.webp` were used as stand-in references for the poses, so the pets are consistent across this kit, but the owner may still change them.
- **The plant is not approved** either (DESIGN.md §6.4). The pot matches across most stages but not all: see `plant-seed` below.
- The lab and solar-system images were not checked by `content-qa`. Don't reuse them in lessons.

## How they were made

1. Every image was generated with Agnes AI (`agnes-image-2.1-flash`) by running the `skills/visual-director` workflow by hand: the base prompt and negative guidance from DESIGN.md §6.2, plus the addition from `skills/visual-director/presets/<preset>.md`, the subject's colour family and the brief. The full prompt for each image is in `manifest.json`.
2. Pet poses, the plant stages and the scenes with pets passed the accepted base image as the Agnes `image` reference (a JPEG data URL works).
3. Each image was checked against the visual-director review checklist. Images that failed (for example a gold ball on the cat's tail, an open circuit, a monument behind the heart, garbled text in the storybook, a seed pot with a sprout) were regenerated with a corrected prompt, up to 3 times.
4. Transparent presets were cut out with `rembg` 2.0.86 (MIT, `isnet-general-use` model). Small specks such as stray confetti were removed. Two cut-outs (`ui-all-caught-up`, `object-calendar`) also needed a flood-fill from the white border, because rembg made parts see-through. Objects were trimmed and padded to the preset ratio. Plant images keep their full frame so they line up for cross-fades.
5. Exported as WebP (quality 82): 768 px for objects and poses, 512 px for badges and crests, 1024 px for empty states and square portraits, 1280 px for scenes.

Each entry in `manifest.json` has `file`, `preset`, `prompt`, `ratio`, `size`, `model`, `generated_at`, `source: agnes`, `licence: owned`, `status`, `alt` (en and hi), `transparent`, the reference image, the delivered size, a sha256 and the number of candidates generated. Images contain no text, so they work in English and Hindi.

## Using them in mocks

- Reference the files directly, for example `assets/cat-wave.webp`.
- Use the `alt` text from the manifest on every `<img>`.
- Transparent images sit on any surface, in light and dark mode. Scenes have their own soft background.
- League crests: the schema has 10 tiers (`game.league_cohorts.tier`, "1 Bronze … 10 Diamond", DB_SCHEMA.md). Only Bronze and Diamond are named in the docs. Silver, Gold and Sapphire here are placeholders until the tier names are decided.

## Weak images

| File | Why |
|---|---|
| `plant-seed.webp` | The pot is smaller and lower than in the other stages, so it won't cross-fade cleanly. |
| `lab-circuit.webp` | A faint monument silhouette in the background. The wire loop is not crisp. |
| `lab-titration.webp` | Extra glassware and a building in the background. |
| `ui-all-caught-up.webp` | The right palm touches the frame edge, and a tiny shadow remnant is left at the bottom right. |
| `storybook-village-pond.webp` | The cat is large and the girl small. The tree is not clearly a banyan. |

## Files

| File | Preset | What it shows |
|---|---|---|
| `cat-base.webp` | pet-cat | The Smriti cat, a small round cream-and-orange cat with a gold tail tip, sitting and smiling. |
| `cat-wave.webp` | pet-cat | The cat waving hello with one paw. |
| `cat-celebrate.webp` | pet-cat | The cat jumping for joy with paws in the air. |
| `cat-thinking.webp` | pet-cat | The cat sitting with a paw on its chin, thinking. |
| `cat-worried.webp` | pet-cat | The cat looking a little worried but hopeful. |
| `cat-sleepy.webp` | pet-cat | The cat curled up and yawning sleepily. |
| `cat-resting.webp` | pet-cat | The cat resting calmly in a woven basket under a blue blanket. |
| `cat-price-tag.webp` | pet-cat | The cat holding up a small blank gold price tag. |
| `cat-reading.webp` | pet-cat | The cat sitting and reading an open book. |
| `cat-headphones.webp` | pet-cat | The cat wearing headphones and talking, ready to chat. |
| `cat-wrench.webp` | pet-cat | The cat holding a small wrench, ready to fix a problem. |
| `cat-plant.webp` | pet-cat | The cat gently holding a small potted plant. |
| `dog-base.webp` | pet-dog | The Smriti dog, a small round golden-brown puppy with floppy ears and a blue collar, standing happily. |
| `dog-wave.webp` | pet-dog | The puppy waving hello with one paw. |
| `dog-celebrate.webp` | pet-dog | The puppy jumping for joy. |
| `dog-thinking.webp` | pet-dog | The puppy tilting its head, curious and thinking. |
| `dog-sleepy.webp` | pet-dog | The puppy lying down, sleepy. |
| `dog-worried.webp` | pet-dog | The puppy looking a little worried but hopeful. |
| `plant-sapling.webp` | plant-stage | The streak plant as a healthy young sapling in its terracotta pot. |
| `plant-seed.webp` | plant-stage | The terracotta pot with soil and one seed, the start of the streak. |
| `plant-sprout.webp` | plant-stage | A tiny two-leaf sprout in the terracotta pot. |
| `plant-budding.webp` | plant-stage | The plant with small flower buds. |
| `plant-flowering.webp` | plant-stage | The plant in full flower with purple flower spikes. |
| `plant-tree.webp` | plant-stage | The plant grown into a small potted tree. |
| `plant-sapling-droopy.webp` | plant-stage | The sapling with drooping leaves, needing care. |
| `plant-sapling-dry.webp` | plant-stage | The sapling with lighter, dry leaves, needing water. |
| `plant-sapling-wilted.webp` | plant-stage | The sapling wilted with a few fallen leaves, still alive. |
| `plant-sapling-dormant.webp` | plant-stage | The plant resting with bare stems and one new bud. |
| `subject-physics.webp` | sunny-object | Physics: a blue atom model. |
| `subject-chemistry.webp` | sunny-object | Chemistry: a flask of bubbling purple liquid. |
| `subject-biology.webp` | sunny-object | Biology: a green DNA double helix. |
| `subject-maths.webp` | sunny-object | Maths: orange geometric shapes, a cube, a cone and a sphere. |
| `subject-history.webp` | sunny-object | History: an ancient clay pot and a scroll. |
| `subject-polity.webp` | sunny-object | Polity and civics: a balance scale. |
| `subject-geography.webp` | sunny-object | Geography: a small terrain model with a mountain, a river and a valley. |
| `subject-economy.webp` | sunny-object | Economy: a piggy bank and gold coins. |
| `subject-english.webp` | sunny-object | English: an open book with a quill pen. |
| `subject-reasoning.webp` | sunny-object | Reasoning: interlocking puzzle pieces. |
| `subject-evs.webp` | sunny-object | General science for young learners: a magnifying glass over a leaf with a ladybird. |
| `scene-welcome.webp` | sunny-scene | The cat and the puppy sitting together on books in a sunny study corner, welcoming you. |
| `object-calendar.webp` | sunny-object | A desk calendar with an alarm clock, for the exam countdown. |
| `ui-notify-bell.webp` | empty-state | The cat tapping a big gold bell, about reminders. |
| `ui-language-hello.webp` | empty-state | The cat and the puppy waving hello together. |
| `scene-exam-goal.webp` | sunny-scene | A stack of books with a gold trophy on top, for choosing your exam goal. |
| `ui-offline.webp` | empty-state | The cat sleeping peacefully on a soft cloud, you are offline. |
| `ui-all-caught-up.webp` | empty-state | The cat relaxing in a hammock, you are all caught up. |
| `ui-search-empty.webp` | empty-state | The cat looking through a magnifying glass, nothing found yet. |
| `scene-lesson-complete.webp` | sunny-scene | The cat jumping for joy among confetti, lesson complete. |
| `scene-guardian-consent.webp` | sunny-scene | A parent and a teenager looking at a phone together at home, giving consent. |
| `ui-signin-saved.webp` | empty-state | The cat holding its plant safe inside a blue shield, your progress is saved. |
| `lab-titration.webp` | sunny-scene | A titration setup with a burette above a conical flask. |
| `lab-circuit.webp` | sunny-scene | A simple circuit with a battery, a switch and a glowing bulb. |
| `lab-optics.webp` | sunny-scene | An optics bench with a candle, a lens and a screen. |
| `lab-heart.webp` | sunny-scene | A clean 3D model of the human heart on a stand. |
| `lab-solar-system.webp` | sunny-scene | A model of the solar system with the sun and planets. |
| `badge-first-lesson.webp` | badge | Badge: an open book with a star, for the first lesson. |
| `badge-streak-7.webp` | badge | Badge: a flame ringed by seven dots, for a seven-day streak. |
| `badge-reviews-100.webp` | badge | Badge: a stack of flashcards with a check mark, for many reviews. |
| `league-bronze.webp` | league-tier | Bronze league crest, tier one. |
| `league-silver.webp` | league-tier | Silver league crest, tier two. |
| `league-gold.webp` | league-tier | Gold league crest, tier three. |
| `league-sapphire.webp` | league-tier | Sapphire league crest, a middle tier. |
| `league-diamond.webp` | league-tier | Diamond league crest, the top tier. |
| `object-gems.webp` | sunny-object | A small pile of shiny blue gems. |
| `object-streak-flame.webp` | sunny-object | A bright streak flame. |
| `shop-hat.webp` | sunny-object | Shop item: a small blue knitted hat with a pom-pom. |
| `shop-scarf.webp` | sunny-object | Shop item: a small striped scarf. |
| `shop-bowtie.webp` | sunny-object | Shop item: a small pink bow tie with dots. |
| `scene-memory-palace.webp` | sunny-scene | A sunny Indian home courtyard with a tulsi planter, a swing and carved doors, a place to store memories. |
| `memory-hook-sample.webp` | memory-hook | Sample memory hook: a giant elephant riding a tiny bicycle over a bridge of pencils. |
| `roleplay-mauryan-scholar.webp` | roleplay-portrait | Portrait of a scholar from the Mauryan era holding palm-leaf manuscripts. |
| `storybook-village-pond.webp` | storybook | A girl and the cat watching ducks at a village pond under a banyan tree. |
