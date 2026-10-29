# Mock illustration kit

Draft art for the UI mocks in `design/mocks/`. It replaces the Fluent emoji stand-ins on the mock screens.

## Status

- **Draft, mock use only.** Nothing here is approved for the product.
- **The mascots are not approved.** DESIGN.md §6.3 asks for a reference sheet per pet (front, three-quarter, side, swatches) and the owner's approval before any other pet art. That has not happened yet. `cat-base.webp` and `dog-base.webp` were used as stand-in references for the poses, so the pets are consistent across this kit, but the owner may still change them.
- **The plant is not approved** either (DESIGN.md §6.4). The five stages (seed, sprout, sapling, flowering, tree) and five sapling health states share one pot. There is no budding stage: the product has five stages only.
- The lab and solar-system images were not checked by `content-qa`. Don't reuse them in lessons.

## How they were made

1. Every image was generated with Agnes AI (`agnes-image-2.1-flash`) by running the `skills/visual-director` workflow by hand: the base prompt and negative guidance from DESIGN.md §6.2, plus the addition from `skills/visual-director/presets/<preset>.md`, the subject's colour family and the brief. The full prompt for each image is in `manifest.json`.
2. Pet poses, the plant stages and the scenes with pets passed the accepted base image as the Agnes `image` reference (a JPEG data URL works).
3. Each image was checked against the visual-director review checklist. Images that failed (for example a gold ball on the cat's tail, an open circuit, a monument behind the heart, garbled text in the storybook, a seed pot with a sprout) were regenerated with a corrected prompt, up to 3 times.
4. Transparent presets were cut out with `rembg` 2.0.86 (MIT, `isnet-general-use` model). Small specks such as stray confetti were removed. Objects were trimmed and padded to the preset ratio. Plant images keep their full frame so they line up for cross-fades.
5. Some Agnes outputs arrive with an alpha channel. They are flattened onto white before the cut-out. Where rembg made enclosed parts see-through (white pages, shield panels, a blank phone screen), a flood-fill from the border or a hole fill restored them.
6. Exported as WebP (quality 82): 768 px for objects and poses, 512 px for badges and crests, 1024 px for empty states and square portraits, 1280 px for scenes.

Each entry in `manifest.json` has `file`, `preset`, `prompt`, `ratio`, `size`, `model`, `generated_at`, `source: agnes`, `licence: owned`, `status`, `alt` (en and hi), `transparent`, the reference image, the delivered size, a sha256 and the number of candidates generated. Images contain no text, so they work in English and Hindi.

## Using them in mocks

- Reference the files directly, for example `assets/cat-wave.webp`.
- Use the `alt` text from the manifest on every `<img>`.
- Transparent images sit on any surface, in light and dark mode. Scenes have their own soft background.
- **Brand files** (`app-icon`, `logo-mark`, `logo-lockup`, `logo-lockup-dark`) are converted from `brand/logo/`, not regenerated or redrawn. Use them instead of stand-in icons.
- **League crests:** 10 plant-named tiers, one set with the same winged shield. The emblem and the material step up together: Seed (clay), Sprout (terracotta), Leaf (bronze), Bud (silver), Bloom (silver and pink enamel), Lotus (gold and pink), Mango (gold and green), Neem (jade), Peepal (deep jade and gold), Banyan (emerald gem).
- **Squad crests** use a plain shield without wings, so they don't read as league tiers.
- **Water sizes:** each image fills its own frame. Show the difference in size by scaling them in the layout.

## Weak images

| File | Why |
|---|---|
| `lab-circuit.webp` | A faint monument silhouette in the background. The wire loop is not crisp. |
| `lab-titration.webp` | Extra glassware and a building in the background. |
| `ui-all-caught-up.webp` | The right palm touches the frame edge, and a tiny shadow remnant is left at the bottom right. |
| `storybook-village-pond.webp` | The cat is large and the girl small. The tree is not clearly a banyan. |
| `object-phone-hands.webp` | The arms are cut off at the frame edges. |
| `cat-blank-cards.webp` | The cat holds a small stack, not a wide fan. |
| `scene-360-fort.webp` | A 16:9 still, not a real equirectangular pano. |

## Files

| File | Preset | Use | What it shows |
|---|---|---|---|
| `cat-base.webp` | pet-cat |  | The Smriti cat, a small round cream-and-orange cat with a gold tail tip, sitting and smiling. |
| `cat-wave.webp` | pet-cat |  | The cat waving hello with one paw. |
| `cat-celebrate.webp` | pet-cat |  | The cat jumping for joy with paws in the air. |
| `cat-thinking.webp` | pet-cat |  | The cat sitting with a paw on its chin, thinking. |
| `cat-worried.webp` | pet-cat |  | The cat looking a little worried but hopeful. |
| `cat-sleepy.webp` | pet-cat |  | The cat curled up and yawning sleepily. |
| `cat-resting.webp` | pet-cat |  | The cat resting calmly in a woven basket under a blue blanket. |
| `cat-price-tag.webp` | pet-cat |  | The cat holding up a small blank gold price tag. |
| `cat-reading.webp` | pet-cat |  | The cat sitting and reading an open book. |
| `cat-headphones.webp` | pet-cat |  | The cat wearing headphones and talking, ready to chat. |
| `cat-wrench.webp` | pet-cat |  | The cat holding a small wrench, ready to fix a problem. |
| `cat-plant.webp` | pet-cat |  | The cat gently holding a small potted plant. |
| `dog-base.webp` | pet-dog |  | The Smriti dog, a small round golden-brown puppy with floppy ears and a blue collar, standing happily. |
| `dog-wave.webp` | pet-dog |  | The puppy waving hello with one paw. |
| `dog-celebrate.webp` | pet-dog |  | The puppy jumping for joy. |
| `dog-thinking.webp` | pet-dog |  | The puppy tilting its head, curious and thinking. |
| `dog-sleepy.webp` | pet-dog |  | The puppy lying down, sleepy. |
| `dog-worried.webp` | pet-dog |  | The puppy looking a little worried but hopeful. |
| `plant-sapling.webp` | plant-stage |  | The streak plant as a healthy young sapling in its terracotta pot. |
| `plant-seed.webp` | plant-stage | Streak plant stage 1 | The terracotta pot with soil and one seed, the start of the streak. |
| `plant-sprout.webp` | plant-stage |  | A tiny two-leaf sprout in the terracotta pot. |
| `plant-flowering.webp` | plant-stage |  | The plant in full flower with purple flower spikes. |
| `plant-tree.webp` | plant-stage |  | The plant grown into a small potted tree. |
| `plant-sapling-droopy.webp` | plant-stage |  | The sapling with drooping leaves, needing care. |
| `plant-sapling-dry.webp` | plant-stage |  | The sapling with lighter, dry leaves, needing water. |
| `plant-sapling-wilted.webp` | plant-stage |  | The sapling wilted with a few fallen leaves, still alive. |
| `plant-sapling-dormant.webp` | plant-stage |  | The plant resting with bare stems and one new bud. |
| `subject-physics.webp` | sunny-object |  | Physics: a blue atom model. |
| `subject-chemistry.webp` | sunny-object |  | Chemistry: a flask of bubbling purple liquid. |
| `subject-biology.webp` | sunny-object |  | Biology: a green DNA double helix. |
| `subject-maths.webp` | sunny-object |  | Maths: orange geometric shapes, a cube, a cone and a sphere. |
| `subject-history.webp` | sunny-object |  | History: an ancient clay pot and a scroll. |
| `subject-polity.webp` | sunny-object |  | Polity and civics: a balance scale. |
| `subject-geography.webp` | sunny-object |  | Geography: a small terrain model with a mountain, a river and a valley. |
| `subject-economy.webp` | sunny-object |  | Economy: a piggy bank and gold coins. |
| `subject-english.webp` | sunny-object |  | English: an open book with a quill pen. |
| `subject-reasoning.webp` | sunny-object |  | Reasoning: interlocking puzzle pieces. |
| `subject-evs.webp` | sunny-object |  | General science for young learners: a magnifying glass over a leaf with a ladybird. |
| `scene-welcome.webp` | sunny-scene |  | The cat and the puppy sitting together on books in a sunny study corner, welcoming you. |
| `object-calendar.webp` | sunny-object |  | A desk calendar with an alarm clock, for the exam countdown. |
| `ui-notify-bell.webp` | empty-state |  | The cat tapping a big gold bell, about reminders. |
| `ui-language-hello.webp` | empty-state |  | The cat and the puppy waving hello together. |
| `scene-exam-goal.webp` | sunny-scene |  | A stack of books with a gold trophy on top, for choosing your exam goal. |
| `ui-offline.webp` | empty-state |  | The cat sleeping peacefully on a soft cloud, you are offline. |
| `ui-all-caught-up.webp` | empty-state |  | The cat relaxing in a hammock, you are all caught up. |
| `ui-search-empty.webp` | empty-state |  | The cat looking through a magnifying glass, nothing found yet. |
| `scene-lesson-complete.webp` | sunny-scene |  | The cat jumping for joy among confetti, lesson complete. |
| `scene-guardian-consent.webp` | sunny-scene |  | A parent and a teenager looking at a phone together at home, giving consent. |
| `ui-signin-saved.webp` | empty-state |  | The cat holding its plant safe inside a blue shield, your progress is saved. |
| `lab-titration.webp` | sunny-scene |  | A titration setup with a burette above a conical flask. |
| `lab-circuit.webp` | sunny-scene |  | A simple circuit with a battery, a switch and a glowing bulb. |
| `lab-optics.webp` | sunny-scene |  | An optics bench with a candle, a lens and a screen. |
| `lab-heart.webp` | sunny-scene |  | A clean 3D model of the human heart on a stand. |
| `lab-solar-system.webp` | sunny-scene |  | A model of the solar system with the sun and planets. |
| `badge-first-lesson.webp` | badge |  | Badge: an open book with a star, for the first lesson. |
| `badge-streak-7.webp` | badge | 7-day streak badge (the plant, not a flame) | Badge: the streak plant pot with a gold sprout ringed by seven dots, for a seven-day streak. |
| `badge-reviews-100.webp` | badge |  | Badge: a stack of flashcards with a check mark, for many reviews. |
| `object-gems.webp` | sunny-object |  | A small pile of shiny blue gems. |
| `shop-hat.webp` | sunny-object |  | Shop item: a small blue knitted hat with a pom-pom. |
| `shop-scarf.webp` | sunny-object |  | Shop item: a small striped scarf. |
| `shop-bowtie.webp` | sunny-object |  | Shop item: a small pink bow tie with dots. |
| `scene-memory-palace.webp` | sunny-scene |  | A sunny Indian home courtyard with a tulsi planter, a swing and carved doors, a place to store memories. |
| `memory-hook-sample.webp` | memory-hook |  | Sample memory hook: a giant elephant riding a tiny bicycle over a bridge of pencils. |
| `roleplay-mauryan-scholar.webp` | roleplay-portrait |  | Portrait of a scholar from the Mauryan era holding palm-leaf manuscripts. |
| `storybook-village-pond.webp` | storybook |  | A girl and the cat watching ducks at a village pond under a banyan tree. |
| `badge-first-mock.webp` | badge | First mock test badge | Badge: a stopwatch with a check mark, for the first mock test. |
| `badge-palace.webp` | badge | First memory palace badge | Badge: a little house with a key, for the first memory palace. |
| `badge-lab.webp` | badge | First lab badge | Badge: a beaker with a star, for the first lab. |
| `league-01-seed.webp` | league-tier | League tier 1 of 10 (Seed) | Seed league crest, tier 1 of 10: a winged shield with a single plump seed. |
| `league-02-sprout.webp` | league-tier | League tier 2 of 10 (Sprout) | Sprout league crest, tier 2 of 10: a winged shield with a tiny two-leaf sprout. |
| `league-03-leaf.webp` | league-tier | League tier 3 of 10 (Leaf) | Leaf league crest, tier 3 of 10: a winged shield with one single large oval leaf lying diagonally with a central vein, no stem, no second leaf. |
| `league-04-bud.webp` | league-tier | League tier 4 of 10 (Bud) | Bud league crest, tier 4 of 10: a winged shield with a closed flower bud on a short stem. |
| `league-05-bloom.webp` | league-tier | League tier 5 of 10 (Bloom) | Bloom league crest, tier 5 of 10: a winged shield with an open five-petal flower. |
| `league-06-lotus.webp` | league-tier | League tier 6 of 10 (Lotus) | Lotus league crest, tier 6 of 10: a winged shield with a lotus flower. |
| `league-07-mango.webp` | league-tier | League tier 7 of 10 (Mango) | Mango league crest, tier 7 of 10: a winged shield with a ripe mango with one leaf. |
| `league-08-neem.webp` | league-tier | League tier 8 of 10 (Neem) | Neem league crest, tier 8 of 10: a winged shield with a sprig of slender serrated neem leaves. |
| `league-09-peepal.webp` | league-tier | League tier 9 of 10 (Peepal) | Peepal league crest, tier 9 of 10: a winged shield with a raised gold peepal leaf: a broad heart-shaped leaf with clearly visible veins and a long thin tapering tail at its tip, clearly a leaf, not a heart symbol. |
| `league-10-banyan.webp` | league-tier | League tier 10 of 10 (Banyan) | Banyan league crest, tier 10 of 10: a winged shield with a broad banyan tree with hanging aerial roots. |
| `cat-hourglass.webp` | pet-cat | Focus timer (MEM) | The cat sitting beside a sand timer, for focus time. |
| `cat-camera.webp` | pet-cat | Photo doubt (AI) | The cat photographing an open notebook with a phone, to ask a doubt. |
| `cat-watering.webp` | pet-cat | Comeback and 2-minute plant rescue | The cat watering a droopy plant to bring it back. |
| `cat-blank-cards.webp` | pet-cat | Empty deck state | The cat holding a fan of blank flashcards, ready to make a deck. |
| `cat-gift.webp` | pet-cat | Referrals | The cat with a wrapped gift box, for inviting friends. |
| `cat-shield-key.webp` | pet-cat | Privacy settings (SET) | The cat holding a small gold key next to a blue shield, for privacy. |
| `dog-resting.webp` | pet-dog | Dog resting or unwell state | The puppy resting calmly in a woven basket under a blue blanket. |
| `dog-headphones.webp` | pet-dog | Voice tutor with the dog | The puppy wearing headphones, ready to talk. |
| `scene-grown-up-first.webp` | sunny-scene | Hand-the-phone to a grown-up; also AUTH-24, AUTH-26, AUTH-28 | A parent and a young child looking at a phone together on a sofa, with the cat and the puppy beside them. |
| `scene-duel.webp` | sunny-scene | Duel lobby (SOC) | The cat and the puppy facing off with question cards, ready for a friendly duel. |
| `scene-friends-locked.webp` | sunny-scene | Friends locked until guardian consent | The cat and the puppy peeking over a garden gate. |
| `scene-maintenance.webp` | sunny-scene | Maintenance (ENT) | The cat with a toolbox next to a big gear, fixing things. |
| `scene-voice-tutor.webp` | sunny-scene | Voice tutor (AI) | The cat with headphones and soft sound waves, ready to talk. |
| `scene-notebook-desk.webp` | sunny-scene | Cornell notes and drill headers | A study desk from above with an open notebook, a pencil and a glass of tea. |
| `scene-360-fort.webp` | sunny-scene | 360 degree scene thumbnail stand-in | A sunny hill fort with sandstone walls on a green hill. |
| `scene-paywall.webp` | sunny-scene | Paywall hero (PAY) | The cat and the puppy holding a big golden tag together. |
| `ll-path-island.webp` | storybook | Little learners home path background (class 1 to 5) | A bright island with a winding stepping-stone path, the little learners' map. |
| `water-cup.webp` | sunny-object | Daily goal, size 1 | Daily goal size one: a small cup of water. |
| `water-can-small.webp` | sunny-object | Daily goal, size 2 | Daily goal size two: a small watering can. |
| `water-can-medium.webp` | sunny-object | Daily goal, size 3 | Daily goal size three: a medium watering can. |
| `water-can-large.webp` | sunny-object | Daily goal, size 4 | Daily goal size four: a large watering can. |
| `level-pencil.webp` | sunny-object | Level object 1 | Level one: a fresh pencil. |
| `level-notebook.webp` | sunny-object | Level object 2 | Level two: a notebook with a bookmark. |
| `level-highlighter.webp` | sunny-object | Level object 3 | Level three: study notes with a highlighter. |
| `object-phone-hands.webp` | sunny-object | Hand the phone over (guardian and second device) | A phone passed from one hand to another. |
| `shop-pro-pot.webp` | sunny-object | Pro plant pot (shop) | Shop item: a gold-rimmed plant pot for Pro. |
| `shop-freeze.webp` | sunny-object | Streak freeze (shop) | Shop item: an ice-crystal charm that freezes your streak. |
| `shop-fish-treat.webp` | sunny-object | Pet treat (shop) | Shop item: a fish-shaped treat for your pet. |
| `object-weekly-chest.webp` | sunny-object | Weekly quest chest | A weekly reward chest with gems inside. |
| `squad-crest-tulsi.webp` | badge | Squad crest 1 | Squad crest: a shield with tulsi leaves. |
| `squad-crest-marigold.webp` | badge | Squad crest 2 | Squad crest: a shield with a marigold. |
| `squad-crest-bamboo.webp` | badge | Squad crest 3 | Squad crest: a shield with bamboo. |
| `scene-student-laptop.webp` | sunny-scene | Web and laptop study hero | A student studying on a laptop at home. |
| `scene-pet-room.webp` | sunny-scene | Pet room backdrop (ME), no pets | A cosy empty pet room with a cushion bed, a rug and a plant. |
| `cat-proud.webp` | pet-cat | Proud moments, level up | The cat standing proudly with its chin up. |
| `app-icon.webp` | brand | App icon in mocks (store, splash, home screen) | The all-exams app icon. |
| `logo-mark.webp` | brand | Logo mark in headers | The Smriti logo mark: two leaves and a spark. |
| `logo-lockup.webp` | brand | Logo lockup on light surfaces | Smriti logo with the name in English and Hindi. |
| `logo-lockup-dark.webp` | brand | Logo lockup on dark surfaces | Smriti logo with the name in English and Hindi, for dark backgrounds. |
