# Smriti — Design System

The source of truth for how Smriti looks, moves and sounds. Values live in [`packages/tokens/tokens.json`](packages/tokens/tokens.json). This file explains them and sets the rules. `docs/UX_FLOW.md` applies them screen by screen.

- **Direction:** "Sunny Subjects". Simple, light and colourful, with big illustrations. No named style gimmicks: no clay, no glassmorphism, no neo-brutalism, no fake paper.
- **Dark mode:** "Night Colour". Deep navy surfaces with the same subject colours, brightened.
- **Reference boards:** [design canvas](https://claude.ai/artifact/BQF48w6kC4bv6PtJhHFzzZ), board 7 (Sunny Subjects) and board 10 (Night Colour).

---

## 1. Principles

1. **One main action per screen.** Everything else is visibly secondary.
2. **Colour carries meaning.** Each subject owns one colour family and uses it everywhere. Status colours (success, error, streak) are never reused for decoration.
3. **An illustration on every key screen.** It explains, rewards or sets the mood. It is never filler, and never a stock photo.
4. **The pet is the voice.** Tips, nudges and empty states speak in the pet's short, warm lines.
5. **Fast on a ₹10,000 phone.** Flat fills and one soft shadow level. Blur, 3D and heavy motion only inside labs.
6. **Bilingual by default.** Every component fits Hindi strings that are 20–30% longer, with no truncation and no text baked into images.
7. **Accessible by default.** WCAG 2.2 AA is the floor, not a goal (§10).

---

## 2. Colour

### 2.1 Core palette

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#F6F7FB` | `#11131C` | App background |
| `surface` | `#FFFFFF` | `#1B1E2B` | Cards, sheets, tab bar |
| `surfaceRaised` | `#FFFFFF` | `#262A3B` | Chips and controls on a surface, pressed rows |
| `surfaceSunken` | `#EEF0F6` | `#161925` | Inputs, tracks behind segmented controls |
| `line` | `#E3E6EF` | `#2C3044` | Dividers, card borders when needed |
| `ink` | `#151A2D` | `#F3F4FA` | Primary text |
| `inkMuted` | `#4A5470` | `#A3A8BF` | Secondary text |
| `primary` | `#3557E8` | `#7B93FF` | Main buttons, links, the active tab |
| `onPrimary` | `#FFFFFF` | `#11131C` | Text and icons on `primary` |
| `streak` / `streakTint` | `#F5A300` / `#FFF1B8` | `#FFC53D` / `#3D3410` | Streak, plant card, gems' glow |
| `success` / `successTint` | `#2FB463` / `#E3F6EA` | `#4ADE80` / `#10392B` | Correct answers, done states |
| `error` / `errorTint` | `#D6363C` / `#FDE8E8` | `#FF6B6B` / `#47202D` | Wrong answers, destructive actions |
| `warning` / `warningTint` | `#F08C00` / `#FFF0E0` | `#FF9F43` / `#3D2A12` | Streak at risk, time running low |

Every colour that text can sit on has a matching `on*` token (text and icons drawn on it) and a `*Text` token (that colour used as text on white or on its tint). Use those tokens. Never put white text on a fill unless the token says so.

### 2.2 Subject colours

Each subject has four values per mode. Exam subjects that aren't listed map to a family through `subjectMap` in the tokens file (for example Economy uses the Polity family).

| Family | Tint (light) | Strong (light) | On strong | Text (light) | Tint (dark) | Strong (dark) |
|---|---|---|---|---|---|---|
| Physics | `#E7EEFF` | `#3557E8` | white | `#3557E8` | `#1E2A4D` | `#7B93FF` |
| Chemistry | `#F1E9FF` | `#7B4DDB` | white | `#794BDB` | `#2A2550` | `#A98BFF` |
| Biology | `#E2F6EA` | `#1F9D55` | ink | `#187B43` | `#123F33` | `#3FD08A` |
| Maths | `#FFEBDC` | `#E8590C` | ink | `#B84609` | `#3D2A12` | `#FF9F43` |
| History and social science | `#FFF1D6` | `#B7791F` | ink | `#946219` | `#3A3110` | `#F2B84B` |
| Polity and economy | `#E3F4F8` | `#0E7C93` | white | `#0D768C` | `#0F3640` | `#2BC3D8` |
| Languages and reasoning | `#FFE4EC` | `#C2255C` | white | `#C2255C` | `#3F1A2A` | `#FF6FA0` |

- **Tint:** card backgrounds (subject tiles, lesson headers, highlighted key terms).
- **Strong:** progress bars, rings, icons, the Continue card fill, and large headings.
- **On strong:** text and icons placed on a strong fill. In dark mode it is always dark ink `#11131C`.
- **Text:** subject-coloured text on white or on its tint (links, key terms, chapter numbers).

### 2.3 Exam accents

The all-exams app and Smriti JEE use primary blue. Other exam apps swap only `primary`:

| App | Light | Dark |
|---|---|---|
| All exams, JEE | `#3557E8` | `#7B93FF` |
| NEET | `#1F9D55` (ink text on it) | `#3FD08A` |
| UPSC | `#0E7C93` | `#2BC3D8` |
| SSC | `#E8590C` (ink text on it) | `#FF9F43` |

Subject colours never change between apps.

### 2.4 Mock runner palette

The mock runner deliberately looks like the real exam (UX_FLOW §4.10), so it uses neutral surfaces and the exam-standard palette. Each state has a shape as well as a colour:

| State | Fill | Shape |
|---|---|---|
| Not visited | white, `#7A8299` border | square |
| Not answered | `#D6363C` | pentagon pointing down |
| Answered | `#1F9D55` | pentagon pointing up |
| Marked for review | `#6C4BFF` | circle |
| Answered and marked | `#6C4BFF` with a green tick badge | circle with a tick |

---

## 3. Typography

- **Latin:** Plus Jakarta Sans. **Devanagari:** Noto Sans Devanagari. Both are open-licence (SIL OFL), loaded with `expo-font` on mobile and self-hosted as WOFF2 on web.
- Hindi text uses the same size steps with a line height **1.15×** the Latin value, so matras never clip.
- Numbers in stats, timers and leaderboards use tabular figures.
- Maths is typeset with KaTeX (pre-rendered to SVG in bundles). Never fake formulas with plain text.

| Style | Size / line height | Weight | Use |
|---|---|---|---|
| `display` | 30 / 36 | 800 | Celebration titles, onboarding headlines |
| `title` | 22 / 28 | 800 | Screen titles, card titles on Home |
| `heading` | 18 / 24 | 700 | Section headings, lesson card headings |
| `body` | 16 / 24 | 500 | Lesson text, explanations |
| `label` | 14 / 20 | 600 | Buttons, chips, list rows |
| `caption` | 12 / 16 | 600 | Meta lines, timestamps, tab labels (11 px minimum on the tab bar) |

Body text in lessons is at most about 60 characters a line on tablets and web. Sentences are short.

---

## 4. Layout, shape and depth

- **Grid:** 4 px base. Spacing steps: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- **Screen padding:** 18–20 px on phones, 24 px on tablets. Cards in a grid are 12 px apart.
- **Radius:** cards 20 (large hero cards 24), sheets 28, buttons 20, chips fully round, inputs 16.
- **Depth:** one card shadow (`0 2 10` at 6% ink), one raised shadow for sheets and floating buttons (`0 8 24` at 10%), and a coloured glow under the primary CTA (`0 10 24` in the primary colour at 35%). Dark mode drops shadows and uses `surfaceRaised` instead.
- **Touch targets:** at least 48 × 48. Primary buttons are 56 tall, full width, pinned in the bottom third.
- **Breakpoints:** phone (< 600), tablet (600–1023), desktop web (≥ 1024). Tablet and desktop use a two-pane layout (list on the left, detail on the right) and cap lesson content at 720 px wide.

---

## 5. Components

Built twice from the same tokens and this spec: `packages/ui-native` for the mobile apps and `packages/ui-web` for the web app (TRD §2.1). Each component has the same name, props and states on both, and logic lives in `packages/app-core`, not in components.

| Component | Spec |
|---|---|
| **Button** | Variants: primary (filled, glow), secondary (surface with `line` border), ghost (text only), destructive (`error`). Sizes 56 and 40. Pressed state scales to 0.97. Loading state keeps the width and shows a spinner. |
| **Subject tile** | Tint background, radius 20, illustration top-right (overlapping the edge is allowed), subject name in `heading`, a progress bar in `strong`, chapter count in `caption`. |
| **Continue card** | Subject `strong` fill, `onStrong` text, large illustration overlapping the right edge, progress bar, [Resume]. Only one per screen. |
| **Streak card** | `streakTint` background, plant illustration on the right, one-line state copy, daily-goal progress. Turns `warningTint` when the streak is at risk. |
| **Option card** (question) | Full width, `surface`, radius 16, `line` border. Selected: `primary` border at 2 px. Correct: `successTint` with a check icon. Wrong: `errorTint` with a cross icon and a 2 × 6 px shake. |
| **Confidence row** | Three segmented chips: Sure, 50:50, Guess. Optional, never blocks [Check]. |
| **Rating buttons** (review) | Again, Hard, Good, Easy, each with a text label and the next interval ("10 min", "2 d"). Colours: error, warning, success, primary. |
| **Progress** | Bar (8 px, radius 4, `track` behind), ring (stroke 10–12), segmented lesson bar. |
| **Chip** | 32 tall, fully round. Filter chips use `surfaceRaised`, and status chips use a tint with its `*Text` colour. |
| **Sheet** | Radius 28 at the top, grabber, `scrim` behind. Heights: 40%, 60% and full. |
| **Tab bar** | 82 tall with the safe area, five tabs, filled icon and `primary` for the active tab, outline icons and `inkMuted` otherwise. Always visible on main screens. |
| **Pet line** | The pet's avatar (40 px) plus a speech bubble on `surface`. At most 2 lines. Used for tips, nudges and empty states. |
| **Stat tile** | Number in `title` with tabular figures, label in `caption`, optional tint background. |
| **Toast** | Bottom, above the tab bar, 4 s, one action at most. Errors stay until dismissed. |
| **Empty state** | Illustration (pet or plant), one line of copy, one action. |
| **Formula box** | Subject tint background, KaTeX SVG, tappable symbols, "Add to formula vault". |
| **Mock palette cell** | 40 × 40, shapes and colours from §2.4, question number in `label`. |

**Icons:** Phosphor Icons (MIT; `phosphor-react-native` on mobile, `@phosphor-icons/react` on web), "bold" weight for outlines and "fill" for active states, at 20, 24 and 32 px. Icons that carry meaning always have a text label or an accessibility label.

---

## 6. Illustration system (Agnes AI)

**Every illustration in the product is generated with Agnes AI.** Nobody hand-draws them, and agents never draw them as SVG or code. Agents run the `visual-director` skill (`skills/visual-director/`), which turns a request into a preset-based prompt, checks the image index first (TRD §9.3), calls Agnes, and sends the result to QA.

The design canvas uses Microsoft Fluent 3D emoji (MIT) as stand-ins. They may also ship as small icons (badges, chips). They are not a substitute for lesson illustrations.

### 6.1 The house style

- **Look:** soft 3D, rounded, friendly forms with a slight toy-like quality. Clean, not cluttered.
- **Light:** soft key light from the top-left, gentle ambient occlusion, a subtle contact shadow. No harsh rim light.
- **Colour:** saturated but not neon. The main object takes its subject's colour family (§2.2), plus at most two accent colours.
- **Background:** transparent for objects and characters. Scenes use a soft gradient in the subject tint.
- **Context:** Indian students, homes, schools, cities and landscapes. Diverse skin tones, regions and genders. Modest, everyday clothing.
- **Never:** text, letters, numbers or labels inside the image (the app overlays them, so they can be translated); brand logos; photorealistic people; gore; anything frightening for young children.

### 6.2 Presets

Each preset is a named prompt template in `skills/visual-director/presets/`. The skill fills the `{placeholders}`. Each preset file also gives the Agnes `size` and `ratio` to request (TRD §9.3). Agnes returns opaque images, so "transparent" outputs are cut out after generation.

| Preset | Use | Output |
|---|---|---|
| `sunny-object` | Subject icons, topic tiles, chapter art, objects in lessons | 1024 × 1024, transparent, the object alone |
| `sunny-scene` | Lesson hero images, onboarding, story beats | 1536 × 1024, soft tint background |
| `sunny-diagram` | Explanatory diagrams (a cell, a circuit, a pulley) | 1536 × 1024, clean, label anchors left empty for app overlays |
| `pet-cat`, `pet-dog` | The two mascots in any pose or mood | 1024 × 1024, transparent, uses the character reference sheet |
| `plant-stage` | The streak plant, 5 stages × 5 health states | 1024 × 1024, transparent, same pot every time |
| `storybook` | Storybook pages and comic strips (class 1–8, history) | 1536 × 1024, flatter 2.5D storybook finish |
| `roleplay-portrait` | Historical figures for role play | 1024 × 1024, respectful, historically grounded dress and setting |
| `memory-hook` | Vivid, slightly absurd images for mnemonics | 1024 × 1024, one clear scene |
| `pano-360` | 360° scenes (monuments, cells, ecosystems) | 4096 × 2048 equirectangular, seamless edges |
| `badge`, `league-tier` | Achievements and league crests | 512 × 512, transparent, centred emblem |
| `empty-state` | Pet or plant in a gentle situation | 1024 × 768, transparent |

**Base prompt (shared by the `sunny-*` presets):**

```
Soft 3D illustration of {subject_matter}, rounded friendly shapes, clean minimal
composition, soft key light from the top left, gentle ambient occlusion, subtle
contact shadow, saturated {colour_family} palette with {accent_colours} accents,
{background}, Indian context where people or places appear, no text, no letters,
no numbers, no logos, high detail, centred, generous padding.
```

**Negative guidance (all presets):** text, watermark, logo, signature, letters, numbers, photorealistic faces, clutter, harsh shadows, neon glow, dark horror tones, distorted hands, extra limbs.

### 6.3 Mascots

Two pets for now: a cat and a dog. The student picks one and names it. Marketing uses default names, suggested as **Miso** (cat) and **Bruno** (dog), until the owner confirms them.

- **Character reference sheet first.** Before any other pet art, `visual-director` generates and gets approval for a reference sheet per pet: front, three-quarter and side views, plus the colour swatches. Every later pet image passes that sheet (or its seed or reference ID, whatever Agnes supports) so the character stays consistent.
- **Cat:** a small, round, cream-and-orange cat with big friendly eyes and a short tail tip in `streak` gold. Curious and a little cheeky.
- **Dog:** a small, round, golden-brown puppy with floppy ears, big eyes and a blue collar in `primary`. Loyal and enthusiastic.
- **Moods** (match the Rive state machine, §7.2): happy, excited, proud, curious, thinking, sleepy, tired, sad-but-hopeful, resting (unwell). Sad and unwell states are always gentle: a blanket, a basket, a sigh. Never distress, never injury.
- **Under-10 mode** only uses happy, excited, curious and sleepy.

### 6.4 The streak plant

- One plant family (a tulsi-like herb in a terracotta pot with a simple pattern), with seasonal variants later.
- **Stages:** seed, sprout, sapling, flowering, tree (a small potted tree).
- **Health:** thriving (upright, glossy), droopy (leaves bent), dry (lighter leaves, curled edges), wilted (head down, a few fallen leaves in the pot), dormant (bare stems with one bud, a "resting" look). It is **never shown dead**.
- 25 images in total (5 × 5), all on the same pot and the same camera, so the Rive file can cross-fade between them.

### 6.5 Delivery and QA

- Generate at 2× the largest display size. Store the original in `smriti-staging` and archive it to Google Drive.
- The publish job makes WebP and AVIF variants (under 80 KB at 960 px, TRD §15) with content-hash names.
- Every image needs alt text in English and Hindi (or is marked decorative) before approval.
- `content-qa` checks diagrams for factual accuracy. A person approves the mascots, the plant and anything for under-10s.
- Approved images are added to the image index with tags, so they are reused before anything new is generated.

---

## 7. Motion

### 7.1 Tokens

| Token | Value | Use |
|---|---|---|
| `fast` | 120 ms | Press feedback, toggles |
| `base` | 200 ms | Most transitions, sheet content |
| `slow` | 300 ms | Sheets, page transitions |
| `emphasis` | 400 ms | Pet mood blends, plant growth |
| `celebrate` | 1200 ms | Confetti, lesson complete |
| Easing `standard` | cubic-bezier(0.2, 0, 0, 1) | Default |
| Spring `pop` | damping 14, stiffness 220 | Check marks, badges, the pet's hop |
| Spring `gentle` | damping 20, stiffness 140 | Cards settling, progress fills |

The moment-by-moment table (taps, correct, wrong, streak +1) is in UX_FLOW §3. **Reduced motion** replaces movement with fades and freezes Rive on static poses.

### 7.2 Rive state machines

`anim-maker` builds these from the Agnes art. Inputs are fixed so app code never changes when art does.

| File | Inputs | Triggers |
|---|---|---|
| `pet-cat.riv`, `pet-dog.riv` | `mood` (0–100), `energy` (0–100), `under10` (bool) | `hop`, `celebrate`, `wave`, `think`, `sleep`, `wake`, `pet` (tap) |
| `plant.riv` | `stage` (0–4), `health` (0–4), `season` (0–3) | `water`, `grow`, `revive` |

Lottie is used only for confetti and small UI flourishes. Reanimated drives everything else.

### 7.3 Gyroscope

Only in 360° scenes, 3D models and a light tilt (at most 6°) on the Home hero illustration. There's always a drag fallback and a [Recenter] button. It is off in reduced-motion mode.

---

## 8. Sound and haptics

- A small sound set (tap, correct, wrong, complete, streak, level up, the pet's purr and bark), each under 1 s and under 30 KB, normalised to the same loudness.
- Silent mode on the phone means no sound. Sound and haptics have separate toggles.
- Haptics: light for taps, success for correct and complete, warning for wrong, medium for the streak.

---

## 9. Dark mode (Night Colour)

- Follows the system setting, with a manual override.
- Use the `dark` token set. Never invert light colours by formula.
- Subject fills use the dark `strong` values with dark ink on them. Tints become deep, low-saturation versions of the same hue.
- Shadows are replaced by `surfaceRaised`.
- Illustrations are unchanged. Their bright colours work on navy.
- The mock runner stays light by default, like the real exam, with dark mode only if the student turns it on.

---

## 10. Accessibility

- **Contrast:** every text token pair in `tokens.json` meets 4.5:1. Muted text on every subject tint is at least 6.2:1. Non-text UI parts (borders, rings, palette cells) are at least 3:1. CI checks the token file.
- **Never colour alone:** correct, wrong, marked and the palette states all carry an icon or a shape.
- **Dynamic type** up to 200%: cards grow, grids drop to one column, and nothing truncates mid-word.
- **Screen readers:** every illustration has alt text in both languages or is marked decorative. The pet's lines are read aloud. Rive and Lottie views are labelled.
- **Captions** on all audio and video. Transcripts for voice-tutor sessions.
- **Focus** follows the visual order. The mock runner works with a hardware keyboard.

---

## 11. Writing style

- Short sentences in plain English or simple Hindi. Talk to the student as "you".
- The pet is warm, never guilt-tripping: "Your plant is thirsty" rather than "You failed your streak".
- Numbers are exact ("18 min drill"), never invented. No fake urgency and no fake scarcity, ever.
- Buttons are verbs: [Start deep dive], [Check], [Save & next].

---

## 12. Logo

The owner chose the mark on 2026-10-29: **Sprout and spark**, option C of the first Agnes round. All files are in `brand/logo/` (see its README). If the final brand name changes (TRD decision D7), the mark stays and only the wordmark changes.

- **The mark:** two plump leaves on a short curved stem, with three gold rays above them, the moment an idea clicks. It reads as growth and memory together.
- **Colours** (`logo` in `tokens.json`): deep leaf `#3557E8` (primary), light leaf `#2BB5E8` (gem), stem `#2282C5`, spark `#F5A300` (streak). Flat fills only, never gradients.
- **Wordmark:** "Smriti" in Plus Jakarta Sans 800 in `ink`, followed by "स्मृति" in Noto Sans Devanagari 800 in `inkMuted`. On dark grounds use `ink` and `inkMuted` from the dark palette.
- **On colour:** on an exam-accent tile the leaves and stem turn white (the light leaf at 78% white so the two leaves stay distinct) and the spark stays gold. On the SSC orange the spark turns white too, because gold doesn't show on orange.
- **Small sizes:** below 48 px use the favicon version, which drops the rays. The rays turn into specks at 16 px.
- **One colour:** a solid silhouette in `ink` or white, for print, embossing and Android's themed icons.
- **App icons:** one per variant, the white mark at 62% of a full-bleed square in that exam's accent. iOS and Android round the corners themselves.
- **Rules:** clear space on every side equal to the height of the light leaf. Don't rotate, outline, add shadows or recolour the mark beyond the versions above. Don't put the full-colour mark on a colour other than white, `bg`, or the dark `bg`.
- **How it was made:** generated with Agnes, then flattened to the brand colours and traced to SVG automatically with VTracer (MIT). The SVG is a draft: before store submission a designer cleans its curves, keeping the path classes (`leaf-deep`, `leaf-light`, `stem`, `spark`), and runs `tools/brand/build_pack.js` again to remake every export.
