# Smriti — Product Requirements Document

| | |
|---|---|
| Status | Draft v0.1, 28 Oct 2026 |
| Owner | Saksham Mittal |
| Working name | Smriti (स्मृति, "memory"). Final brand TBD. |
| Visual style | Sunny Subjects: light, colour-coded subjects, big illustrated cards (see `DESIGN.md`). Dark mode based on Night Colour. |
| Related docs | `APP_FLOW.md`, `UX_FLOW.md`, `TRD.md`, `DB_SCHEMA.md`, `IMPLEMENTATION_PLAN.md` |

---

## 1. Summary

Smriti is a gamified learning platform for Indian learners, from class 1 to 12 and on to competitive exams: JEE Main, JEE Advanced, NEET UG, UPSC CSE, SSC and other government exams. It aims for the habit loop of Duolingo, the hands-on understanding of Brilliant and the delight of Matiks. Lessons are visual first. Every subject is taught in the way that suits it: lab simulations for science, role play for history, derivations and 3D for maths. Memory science (spaced repetition, mnemonics, songs, memory palaces) is built into every lesson.

Two characters keep students coming back: a **pet** (a cat or a dog that the student picks) and a **streak plant**. Both thrive when the student studies daily, and both slowly decline when the student stops. The decline is always recoverable.

The product is freemium. The free tier works **without login**. Pro costs **₹99/month**, and the first month costs **₹1**.

One backend and one templated app codebase produce:
- **Smriti (all exams)**: every exam and class in one app.
- **Per-exam apps** such as "Smriti JEE", "Smriti NEET", "Smriti UPSC" and "Smriti SSC", each published separately on the Play Store and App Store for search visibility. Each one is locked to its exam's content, mocks and branding.

## 2. Goals and non-goals

### 2.1 Goals
1. **Learning that sticks.** Students remember what they learn weeks later, which we measure through spaced-repetition recall rates.
2. **A daily habit.** Students come back every day because of the pet, the plant, streaks and friends.
3. **Complete coverage.** For each exam in scope, every syllabus fact, formula, shortcut, example, diagram and previous-year question (PYQ) pattern is mapped. Nothing in the official syllabus is left out.
4. **Mock tests that match the real exam.** Section timers, question types, marking and the exam interface all follow the latest official pattern.
5. **Affordable and open.** Students get value without signing up, and Pro costs less than a samosa a day.
6. **Bilingual from day one.** English and Hindi in Phase 1, with the structure ready for more Indian languages.

### 2.2 Non-goals (for now)
- Live classes or human tutors.
- Headset VR. Only phone-based 360° views (gyroscope or drag) are in scope.
- A marketplace for teacher content.
- Writing the actual study content in this project phase. The repo ships **agent skills** that generate content later (see §14).

### 2.3 Success metrics

| Metric | Target at 6 months after launch |
|---|---|
| Day 1 / Day 7 / Day 30 retention | 50% / 30% / 18% |
| Average streak length (active users) | ≥ 9 days |
| Guest → signed-up conversion | ≥ 25% of guests who finish 3 lessons |
| Free → Pro (₹1 trial start) | ≥ 6% of signed-up users |
| Trial → paid month 2 | ≥ 45% |
| 7-day recall on spaced-repetition cards | ≥ 85% |
| Mock score improvement (first vs 5th mock, same exam) | +15% median |
| Crash-free sessions | ≥ 99.5% |
| Cold start on a ₹10k Android phone | < 2.5 s |

## 3. Users

| Persona | Age | Context | What they need from Smriti |
|---|---|---|---|
| **Little learner** (class 1–5), with a parent | 6–10 | Shared phone, Hindi or English medium | Stories, rhymes, the pet, very short sessions, parent controls |
| **Board student** (class 6–12) | 11–17 | CBSE / ICSE / state board, school plus tuition | Chapter-wise lessons, quick revision before tests, labs, doubt solving |
| **JEE / NEET aspirant** | 16–19 | Coaching or self-study, high pressure | Depth, PYQs, real mocks, time analysis, shortcuts, formula sheets |
| **UPSC / SSC aspirant** | 21–30 | Graduate, self-study, often from a Hindi-speaking region | Huge factual load, memory techniques, current-affairs revision, CBT mocks |
| **Returning learner** | any | Lapsed streak | A gentle way back, a pet that can be nursed back to health, no shaming |

Under-18 users are a large share of the audience, so child-safety and consent rules apply (§16.4).

## 4. Exams and content scope

### 4.1 Exams in scope

| Track | Exams | Phase |
|---|---|---|
| School | Class 1–12 (CBSE first; state boards and ICSE later) | 1 (classes 9–12), 2 (1–8) |
| Engineering | JEE Main, JEE Advanced | 1 |
| Medical | NEET UG | 1 |
| Civil services | UPSC CSE Prelims (GS + CSAT), then Mains GS | 1 (Prelims), 3 (Mains) |
| Staff Selection | SSC CGL, CHSL, MTS, GD | 2 |
| Other government exams | Banking (IBPS / SBI PO and Clerk), Railways (RRB NTPC, Group D), state PSCs, Defence (NDA, CDS) | 3+ |

### 4.2 One content graph, many exams
Content is written once and tagged for many exams. The hierarchy is:

```
Subject → Unit → Chapter → Topic → Subtopic → Concept (the atomic unit)
```

- A **Concept** is the smallest teachable idea, such as "Kinematics: relative velocity in 1D". Every fact, formula, shortcut, example, diagram, mnemonic, flashcard and question links to one or more Concepts.
- Each Concept has a **depth level** from L1 to L5:
  - L1: basic, school level
  - L2: board-exam level
  - L3: competitive basics (SSC, NEET, JEE Main)
  - L4: advanced (JEE Main hard, NEET toppers)
  - L5: elite (JEE Advanced, Olympiad)
- An **Exam Profile** decides which Concepts are included and up to which depth. JEE Advanced pulls Physics Concepts up to L5. NEET pulls the same Concepts up to L3–L4 and adds biology. SSC pulls arithmetic up to L3 with shortcut tricks.
- **Exam weightage and PYQ frequency** are stored per Exam × Concept, so the app can prioritise high-yield topics for each exam.
- A per-exam app simply sets the Exam Profile and hides everything else.

### 4.3 Exam blueprints
Each exam's pattern is **data, not code**. The current patterns are listed below as starting values. Each one must be checked against the latest official notice before launch, and re-checked every exam cycle.

| Exam | Pattern (verify against the official notice each cycle) |
|---|---|
| JEE Main Paper 1 | CBT, 3 h, Physics, Chemistry and Maths with 25 Qs each (Section A: 20 MCQs, Section B: 5 numerical). 75 Qs, 300 marks. +4 / −1. Two sessions (Jan, Apr). |
| JEE Advanced | 2 papers × 3 h, CBT. Question types change every year: single-correct, multi-correct with partial marking, integer / numerical, matching lists. The blueprint must support all of them. |
| NEET UG | Pen and paper, 3 h, 180 compulsory MCQs (Physics 45, Chemistry 45, Botany 45, Zoology 45), 720 marks. +4 / −1. No Section A / B. |
| UPSC Prelims | GS Paper I: 100 Qs, 200 marks, 2 h. CSAT Paper II: 80 Qs, 200 marks, 2 h, qualifying at 33%. −⅓ for each wrong answer. |
| SSC CGL Tier 1 | CBT, 60 min, 4 sections × 25 Qs (Reasoning, General Awareness, Quant, English), 200 marks. −0.5. |

The blueprint model (§9.3) covers sections, sectional timers, section switching rules, question types, marking schemes (including partial marking), the paper-specific interface (an NTA-style palette, an OMR-style sheet for NEET practice), languages, calculator rules and qualifying cut-offs.

## 5. Learning experience

### 5.1 Two modes for every topic

| | **Deep Dive** | **Quick Revision** |
|---|---|---|
| Purpose | First-time learning and real understanding | Recall before a test, or daily upkeep |
| Length | 8–20 min per subtopic, split into 2–4 min "bites" | 2–5 min per topic |
| Content | Story hook → intuition → visual explanation → interaction or sim → derivation or worked example → check questions → memory hook → summary | One-page illustrated cheat sheet, key formulas, mnemonics, 5–10 rapid-fire cards, "common traps" |
| Output | Concepts marked "learned"; spaced-repetition cards scheduled | Cards reviewed, confidence updated |

Every topic and subtopic offers both modes. The student switches with a toggle on the topic card.

### 5.2 Lesson building blocks ("cards")
A lesson is a sequence of typed cards, defined in content bundles (see the TRD). The card types are:

- **Story / hook**: a scenario, a short comic or a story. Visuals are generated by Agnes AI.
- **Explainer**: text with an illustration or diagram, highlights and audio narration.
- **Animated explainer**: a Lottie or Rive animation, or a short clip.
- **Interactive**: drag, sort, slider, graph manipulation, tap to reveal.
- **Simulation / virtual lab**: an embedded sim with controls and observation tasks.
- **3D model**: rotatable and zoomable, with an exploded view and labels. Supports gyroscope "look around".
- **360° scene**: a phone-based field trip using the gyroscope or drag, such as Harappa, the solar system or a cell interior.
- **Derivation**: stepwise, each step revealed on tap, with "why?" expandable.
- **Worked example**: problem, attempt, hints, solution, and a shortcut if one exists.
- **Question**: MCQ, multi-select, numerical, match, fill in the blank, order the steps, assertion-reason, statement-based (UPSC style).
- **Memory hook**: mnemonic, rhyme or song, memory-palace placement, or an AI-generated cue.
- **Role play / dialogue**: chat with a historical figure or character, guided by an LLM.
- **Video**: a YouTube lesson from the @examatlas.official playlists, with timestamps linked to concepts.
- **Fun experiment**: a home-safe physics or chemistry experiment with steps and a "why it works" section.
- **Summary**: illustrated key points, which feed the cheat sheet.

### 5.3 A teaching style for each subject

| Subject | Main teaching style | Signature features |
|---|---|---|
| Physics | Intuition → sim → derivation → problems | Virtual labs (circuits, optics benches, pendulums), 3D vectors, gyroscope-driven motion demos, fun home experiments, shortcut sheets for common question types |
| Chemistry | Visualise particles → reactions → patterns | Interactive periodic table, 3D molecules and orbitals, virtual titration and salt analysis, reaction-mechanism animations, named-reaction mnemonics |
| Biology | Structures → processes → stories | 3D anatomy (organs, cells), labelled diagram drills, life-process animations, 360° cell and ecosystem trips, NCERT-line recall |
| Mathematics | Visual proof → technique → practice | Graph playgrounds, 3D solids and surfaces, stepwise derivations, "trick vs method" comparisons, mental-maths speed drills (Matiks-style) |
| History | Narrative and role play | Chat with Ashoka or Akbar, comic-strip short films, timelines, "you decide" scenarios, monument 360° tours, memory palaces for dates |
| Geography | Maps and exploration | Interactive maps, layer toggles, 360° landforms, map-pinning drills |
| Polity / Economy | Cases and analogies | "Constitution as a house" analogies, mock parliament role play, flowcharts, budget simulators |
| English / languages | Usage and play | Vocabulary through stories, error spotting, reading comprehension with highlights |
| Reasoning / Quant (SSC, CSAT) | Pattern drills | Speed rounds, shortcut cards, puzzle games, timed ladders |
| Current affairs (UPSC, SSC) | Daily digest | Daily illustrated cards, a weekly quiz, links to static topics |
| Class 1–5 | Story, song and play | Storybooks, rhymes, tracing, the pet as narrator, parent mode |

**Styles across subjects:** parody and humour (spoof news, meme recaps), storybooks, mimicry and voice characters, songs and rhymes.

### 5.4 Memory system
Memory is a core system, not an add-on.

1. **Adaptive spaced repetition.** The FSRS algorithm models a forgetting curve for every card. Cards are graded Fail, Hard, Good or Easy, and the engine predicts what the student will forget and when. Every learned Concept creates cards, and the daily review queue mixes them with new learning. It runs fully offline on the device.
2. **Retrieval practice first.** Lessons ask questions before explaining whenever it helps.
3. **Mnemonics, rhymes and songs.** Popular existing ones (for example VIBGYOR, HOMES, "King Henry Died..." and Hindi equivalents) plus AI-generated ones.
4. **AI mnemonic forge.** On any fact, "Make it stick" generates a custom story, acronym, memory-palace room, keyword image or rhyme, with an optional Agnes image. It is course-aware, so a UPSC student gets a different style from a JEE student. The student can save the result to their own cards. "Create a memory hook for Article 356" works as a free-text request too.
5. **Interactive memory palace.** The student builds rooms (their home, their school, a famous monument, or a provided 360° scene), drags facts into them, and reviews by walking through. Simple illustrated rooms come first, and 3D rooms later.
6. **Audio mnemonics and rhymes.** Text-to-speech turns lists and rhymes into catchy audio hooks, for audio-first learners and for visually impaired students.
7. **Emotion tagging.** The student attaches a feeling, a personal memory or an emoji to a fact. This uses the emotional-memory effect.
8. **Metacognitive dashboard.** On every answer the student taps Sure, 50:50 or Guess. A confidence heat map per topic and a calibration score (predicted versus actual performance) expose the "illusion of knowing".
9. **Pomodoro and distributed practice.** Focus timer sessions (25/5 by default) and a nudge to spread short sessions across days instead of cramming. The pet "naps" during breaks.
10. **Interleaved practice.** A session builder that mixes subjects once the basics are learned, such as Polity + Economy + Environment for UPSC or Physics + Maths for JEE.
11. **Sleep review scheduling.** The app learns the student's usual bedtime from their usage pattern and offers the hardest 5 due cards about 20 minutes before it, for consolidation during sleep.
12. **Predictive weak-area alerts.** From the forgetting-curve model: "You'll forget the IPC sections in 2 days. 4 cards are due tonight."

**Technique library.** Each technique has a short explainer card, a worked example for the student's exam, and a matching card type or tool where it fits:

| Technique | How it appears in the app |
|---|---|
| Acronym and acrostic mnemonics | Mnemonic cards and the mnemonic forge |
| Narrative and story linking | "Explain as a story" and the forge's story mode |
| Dual coding | Every explainer pairs words with an Agnes illustration or diagram |
| Keyword (linkword) method | Forge mode for vocabulary, foreign terms and legal definitions, with a sounds-like image |
| Chunking | Long lists (dates, formulae, constants) are shown and reviewed in chunks of 3–5 |
| PAO (person–action–object) | Forge mode that packs three data points into one vivid scene |
| Major system | Forge mode that turns numbers into words, for constants, dates and article or section numbers |
| Peg system | A set of illustrated pegs (1 = bun, 2 = shoe, …) that new lists hang on |
| Method of loci | The memory palace |
| Elaborative interrogation | "Why is this true?" prompts inside lessons and reviews |
| Feynman technique | The Feynman tutor mode (§5.5) |
| Cornell notes | The smart Cornell notepad (§5.6) |
| Mind mapping | The mind-map builder (§5.6) |

### 5.5 AI features
- **AI tutor (chat).** Context-aware: it knows the current card, the student's mastery and the exam. It guides with hints before giving answers, and supports Hindi, English and Hinglish. It can generate diagrams through Agnes.
- **Feynman tutor.** The student explains a concept in their own words, by typing or speaking. The AI grades clarity, asks follow-up questions and surfaces gaps, instead of only marking right or wrong.
- **Realtime voice tutor.** Talk through a doubt hands-free, with interruption support (Gemini Live, see the TRD). Pro only, with a fair-use limit.
- **Image-generation agent.** The tutor and the lesson runtime decide when a visual would help (to explain, to make a story, or to create a memory cue) and call Agnes AI. Generated images are cached and reused across users when the prompt is the same (see the TRD).
- **Story generation.** "Explain this as a story" produces a short illustrated story for any concept.
- **Doubt from photo.** Snap a textbook or question photo and get a step-by-step solution linked to the Concepts.
- **Personal plan.** The planner builds a daily plan from the exam date, mastery levels and the time available.
- **Safety.** Age-appropriate filters, no off-topic chats for under-13 users, and citations to the platform's content wherever possible.

### 5.6 Other study tools
- Flashcards: auto-generated from lessons, plus the student's own. Any note can become a spaced-repetition deck in one tap.
- **Smart Cornell notepad.** Notes in Cornell format (cue, notes, summary). The AI fills the cue column and the summary, then turns the note into flashcards.
- **Mind-map builder.** The AI generates a topic mind map from the syllabus graph. Students annotate it and draw links across subjects.
- **Video lessons.** YouTube playlist lessons, with flashcards generated from the lecture transcript.
- Revision sheets and cheat sheets for each topic, chapter and exam.
- **Export as PDF book**: any set of topics becomes a printable, illustrated revision book. Pro only.
- Formula vault and shortcut vault, searchable.
- Interactive periodic table, unit converter, and constants table.
- Bookmarks, notes and highlights on any card.
- Offline downloads of lessons and media. Pro only.

## 6. Practice and assessment

### 6.1 Practice
- Practice sets for each concept, adaptive in difficulty.
- PYQ bank filtered by exam, year, topic and difficulty. Each PYQ links to its Concepts.
- "Weak spot" drills that are generated from analytics.
- Mocks generated from weak areas, using the spaced-repetition and mastery data.
- Every solution has a Feynman-style explanation: plain language first, then the formal steps.
- Daily challenge: one shared puzzle per exam per day, with a leaderboard.

### 6.2 Mock tests
- **Full mocks** that replicate the real exam from its blueprint: section timers, section lock or switch rules, question palette states (not visited, not answered, answered, marked for review, answered and marked), language toggle, on-screen calculator where allowed, and auto-submit at time-up.
- **Sectional and chapter mocks.**
- **PYQ papers** presented as mocks.
- **Live mocks**: a scheduled all-India mock with ranks and percentiles.
- **Exam-day simulation**: an optional full-screen mode with distractions blocked and a countdown that matches the real reporting time.

### 6.3 Analytics
- Score, rank, percentile and predicted rank (once enough data exists).
- **Time analysis**: time per question, ideal versus actual, too slow when correct, too fast when wrong, the order in which the student attempted questions, and time lost on skipped questions.
- **Concept analysis**: accuracy and speed per Concept, Topic and Subject, with a heat map over the syllabus.
- **Confidence analysis**: accuracy split by Sure / 50:50 / Guess, plus a "lucky guesses" count.
- **Mistake types**: conceptual, calculation, misread, silly.
- **Next steps**: auto-built revision lists and drills.
- **Progress over time**: mock trend, mastery growth and the share of the syllabus covered.

## 7. Gamification

| Element | Behaviour |
|---|---|
| XP | Earned for lessons, reviews, questions and mocks. Bonus for combos and perfect lessons. |
| Streak | One qualifying activity a day: one lesson, or 10 reviews, or one mock section. Streak freezes can be bought with gems or come with Pro. |
| **Streak plant** | Grows through stages as the streak continues: seed → sprout → sapling → flowering → tree, with seasonal variants. A missed day makes it droop, a few days makes it dry, and a long gap makes it wilt to a dormant stump. **It is never permanently dead.** Watering it (studying) revives it over a few days. Rare plants unlock at milestones. |
| **Pet mascot** | A cat or a dog, chosen at onboarding, and named by the student. It has mood and health meters. It is happy and energetic with a regular habit, sleepy and then weak and sad with neglect, and at the lowest point it becomes "very sick" and rests in a basket. **Decline is recoverable:** care actions (studying, reviews) bring it back. It never dies permanently. It reacts to answers, cheers on streaks, narrates for young kids and appears throughout the app. |
| Gems | Soft currency for freezes, pet accessories, plant pots and themes. No real-money gem packs for under-18 users. |
| Leagues | Weekly leagues by XP, with promotion and demotion (Duolingo-style), grouped by exam. |
| Leaderboards | Friends, school or coaching group, city and all-India, per exam. |
| Quests and badges | Daily and weekly quests and milestone badges such as "Periodic Table Master". |
| Collections | Illustrated card albums collected from lessons (for example, every element of the periodic table). |
| Combo and celebrations | Confetti, pet dances, sounds and haptics. |

Humane design rules:
- No shame messaging.
- Reminders are capped.
- A "rest day" option exists.
- The pet's sadness is gentle, never distressing for young kids. Under-10 mode uses only the "sleepy" states.

## 8. Social
- Friend profiles: avatar, pet, plant, streak, badges and exam.
- **Duo / study buddy**: a paired streak with shared goals and nudges.
- Friend quests (cooperative) and head-to-head challenges (live quiz duels).
- Study groups / squads: a group leaderboard and group mocks.
- Collaborative notes and decks: share flashcard decks and cheat sheets.
- Invite and referral: both people get a free week of Pro.
- Moderation: no open DMs for under-18 users, only preset reactions and messages, plus reporting and blocking.

## 9. Engagement surfaces

### 9.1 Notifications and reminders
- A daily reminder at a time the student picks, voiced by the pet.
- "Plant is thirsty" and "pet misses you" nudges, capped at one a day.
- Review-due, mock-scheduled and friend-activity notifications.
- Smart timing that learns the student's usual study hour.
- Quiet hours, with defaults stricter for minors.
- Push on mobile and web push on desktop.

### 9.2 Home-screen widgets
- The streak plant widget, which shows the current plant state.
- The pet widget, which shows mood and has a one-tap "quick review".
- An exam countdown and today's plan.
- Android widgets and iOS WidgetKit widgets.

### 9.3 Updates
- In-app update prompts: a soft prompt for minor versions and a forced update below a minimum version.
- Content updates arrive over the air through content bundles, without a store update.

## 10. Onboarding, guest mode and accounts

### 10.1 Guest-first
- The app opens straight into onboarding. No login wall.
- The guest can do lessons, quick revision, a limited number of practice questions and sample mocks. Progress is stored locally.
- **Login prompts** appear only at moments of value:
  - saving progress across devices
  - reaching the end of the 3rd lesson
  - joining a league or adding friends
  - starting the ₹1 trial
  - before streak day 3 ("don't lose your plant")
- When the guest signs up, local progress merges into the new account.

### 10.2 Onboarding steps
1. Welcome splash with the pet animation.
2. Choose language (English / हिन्दी).
3. "What are you preparing for?" (exam or class).
4. Target year or exam date.
5. Current level (a quick placement quiz, which can be skipped).
6. Daily goal (5 / 10 / 20 / 30 min).
7. Pick a pet (cat or dog), name it, and see it hatch or arrive.
8. Plant the seed: the first streak-plant moment.
9. First 2-minute lesson right away.
10. Notification permission, framed by the pet: "Can I remind you?"

Per-exam apps skip step 3.

### 10.3 Accounts
- Auth through Supabase: phone OTP (the main method in India), Google, Apple, and email magic link.
- Profiles hold a display name, avatar, pet, exams, class, school or coaching (optional), city and language.
- Parent accounts for under-13 users: consent, time limits and weekly reports.

## 11. Monetisation

### 11.1 Tiers

| | Free (no login needed) | Pro, ₹99/month (first month ₹1) |
|---|---|---|
| Lessons | All Quick Revision, plus Deep Dive for the first 2 chapters of every subject, plus daily rotating free chapters | All Deep Dives |
| Practice | 30 questions/day, a sample of PYQs | Unlimited, full PYQ bank |
| Mocks | 1 sectional mock a week, 1 sample full mock | All mocks, live all-India mocks, full analytics |
| AI tutor | 5 messages/day, text only | Higher limits, voice tutor, Feynman tutor, photo doubts |
| Memory | Spaced repetition, the community mnemonics, the technique library | AI mnemonic forge, memory palaces, audio mnemonics, sleep review |
| Tools | Cheat sheets, flashcards, Cornell notes (manual) | PDF book export, offline downloads, AI Cornell fill, AI mind maps |
| Gamification | Everything, including 1 streak freeze a month | 2 freezes a month, exclusive pets' outfits and plants |
| Ads | None (no ads ever for minors) | None |

The exact free limits are flags (see the TRD) so they can be tuned.

### 11.2 Pricing and payments
- ₹99/month is the default. A ₹799/year option is offered later.
- The ₹1 first month is an **introductory offer** on each platform, once per account and device.
- Payment channels:
  - **Web:** Razorpay Subscriptions with UPI Autopay, cards and netbanking.
  - **Android:** Google Play Billing. User-choice billing is considered later.
  - **iOS:** StoreKit in-app purchase.
- RevenueCat unifies entitlements across all three.
- Pro is shared across all Smriti apps (the per-exam apps and the all-exams app) on the same account.
- Family plan for siblings: Phase 3.

## 12. Multi-app strategy and SEO
- One codebase builds each app variant from a config: name, bundle ID, icon, colour accent, exam profile, store listing and deep-link domain.
- Store listings target exam keywords. Example: "Smriti JEE: Main & Advanced Prep, Mocks, PYQs".
- The marketing site is built with Astro. It has static, indexable pages for every exam, subject, chapter and topic, free cheat sheets and PYQ explanations, all in English and Hindi with hreflang tags. These are the main organic acquisition channel.
- YouTube (@examatlas.official) playlists are embedded in lessons and linked from topic pages, so video and app reinforce each other.

## 13. Localisation and accessibility
- Phase 1 languages are English and Hindi. Full UI and content are in both, and students can switch per lesson. Hinglish is supported in AI chat.
- Content is stored with a locale for each field, so adding a language means adding strings and assets without changing the schema.
- Fonts support Devanagari: Plus Jakarta Sans for Latin text, paired with Noto Sans Devanagari for Hindi.
- Accessibility targets WCAG 2.2 AA: scalable text, screen-reader labels on every illustration and icon, captions on all video and audio, reduced-motion mode, colour-blind-safe status colours, and haptics that can be turned off.

## 14. Content production (out of scope for this phase)
This phase builds the **machinery**, not the content. The repo ships **agent skills** that any coding agent (Claude Code, Codex and others) can run to produce content:

- `syllabus-mapper`: turns an official syllabus into the Concept graph with exam tags and depth levels, and produces a coverage checklist so nothing is missed.
- `lesson-author`: writes Deep Dive and Quick Revision bundles in the card schema, in English and Hindi.
- `question-author`: writes questions, solutions and shortcuts for each Concept and exam style, tagged with difficulty.
- `pyq-ingest`: structures previous-year papers and links them to Concepts.
- `mnemonic-maker`: creates mnemonics, rhymes and memory-palace scripts.
- `visual-director`: plans and generates illustrations through Agnes AI using the Sunny Subjects illustration style guide.
- `sim-builder`: builds interactive simulations and labs in the sim framework.
- `model-3d-sourcer`: finds, checks the licence of, optimises and imports 3D models.
- `anim-maker`: makes Lottie or Rive animations and micro-interactions.
- `exam-blueprint`: encodes an exam's pattern from its official notification.
- `content-qa`: checks facts, coverage, language and accessibility.
- External skills referenced: `anatomy` (MIT) for explanatory machine illustrations and `colorfigures` for interactive isometric figures.

The quality bar is that **every** syllabus item in scope has at least one Concept, one explainer, one practice question and one revision card. The coverage dashboard must be at 100% before an exam is published.

## 15. Reference platforms and assets

### 15.1 What we borrow from each
- **Duolingo:** streaks, leagues, the lesson path, character-led motivation, celebrations.
- **Brilliant (and its Koji tutor):** learn by doing and interactive problems. Koji is a tutor character built with Rive and voiced through ElevenLabs. We use the same approach for the pet.
- **Matiks:** speed maths duels and a slick competitive feel.
- **Khan Academy / Khanmigo:** a Socratic AI tutor that never just hands over answers.
- **Kahoot, Blooket, Quizizz:** live quiz duels, game modes and power-ups.
- **Elevate, Lumosity:** skill games and progress graphs.
- **Forest, Headspace:** a growing plant tied to focus time, and a calm tone.
- **Nearpod:** 360° field trips as emotional memory hooks inside lessons.
- **Nobook:** virtual labs where students assemble apparatus from 1,000+ instruments, plus physics and chemistry engines.
- **Tinkered, EasyCircuit:** prompt-to-circuit design and a build → simulate loop. This informs electronics labs.
- **Animagraffs:** detailed animated cutaways of how things work.
- **IndicCore:** confidence tagging (Sure / 50:50 / Guess), weak-topic drills and UPSC analytics. Pricing benchmark: ₹299/month.

### 15.2 Open-source and open-licence asset sources
**Always check the licence of each item before use.**

| Source | What it offers | Licence (verify) |
|---|---|---|
| PhET Interactive Simulations | Physics, chemistry and maths sims (HTML5) | CC BY 4.0 |
| Open Source Physics / EJS | Physics sims | Mostly open, varies by item |
| Smithsonian 3D | Museum 3D models | Many are CC0 |
| NASA 3D Resources | Space models and textures | Public domain |
| NIH 3D | Biomedical and anatomy models | Varies by item |
| Z-Anatomy / BodyParts3D | Full human anatomy | CC BY-SA |
| RCSB PDB, PubChem | Molecule and protein structures | Open data |
| 3Dmol.js / Mol* | Molecule viewers | BSD / MIT |
| Poly Haven, Quaternius, Kenney | Textures, HDRIs, low-poly models | CC0 |
| Sketchfab (CC filter) | 3D models | CC variants. Avoid NC for commercial use. |
| Periodic-Table-JSON | Element data | CC BY-SA |
| OpenStax | Reference textbooks for fact checks | CC BY |
| ChemCollective | Virtual chemistry labs | **Non-commercial.** Use for reference only. |

## 16. Non-functional requirements

### 16.1 Performance
- Runs well on 3 GB RAM Android phones.
- App size under 45 MB, including a small seed pack (onboarding lessons and the first chapter for the variant's exam) so the app teaches on first launch with no network. Everything else downloads on demand.
- 60 fps for animations, with heavy 3D and blur effects turned off on low-end devices.

### 16.2 Offline
- The current lesson, the review queue, the memory palace and downloaded packs work fully offline.
- Progress syncs when the device is back online.
- Content updates download as small patches (new or corrected cards), not whole packs again.

### 16.3 Reliability and observability
- 99.9% API availability.
- Structured logs, metrics and distributed tracing across app, web and backend.
- Error tracking and product analytics.

### 16.4 Privacy and safety
- India's **DPDP Act 2023** and the DPDP Rules apply. For users under 18:
  - verifiable parental consent
  - no behavioural ad targeting
  - no tracking or behavioural monitoring of children beyond what education needs
- Data minimisation, and a data export and delete option in settings.
- Leaderboards show only first name and initial for minors by default.

### 16.5 Security
- OWASP MASVS for the mobile apps.
- Row-level security on all user data in Supabase.
- Receipt validation for payments on the server.

### 16.6 Scale
- Designed for 1M monthly active users in year one.
- Spikes around exam dates and live mocks.

## 17. Release phases

| Phase | Scope |
|---|---|
| **0 · Foundations** | Monorepo, design system, content schema, agent skills, auth, guest mode, pet and plant engine, lesson player, spaced repetition |
| **1 · MVP** | All-exams app plus Smriti JEE and Smriti NEET. Classes 11–12 PCM / PCB. Physics, Chemistry and Biology labs (first 20 sims). Mocks for JEE Main and NEET. AI tutor chat. Pro with ₹1 trial. English and Hindi. Web app and Astro site. |
| **2** | UPSC Prelims and SSC CGL apps. Voice tutor. Leagues and friends. Widgets. Memory palaces. PDF export. Classes 9–10. |
| **3** | JEE Advanced depth, more government exams, live all-India mocks, classes 1–8, parent mode, more languages |

## 18. Risks and open questions

| Risk or question | Mitigation or owner |
|---|---|
| Making content complete is a huge job | Agent skills, coverage dashboard, phased exams |
| Factual errors in AI-generated content | `content-qa` skill, citations, human review before publish, "report an error" on every card |
| Image-generation cost and consistency | Prompt cache and reuse, a style guide, seeded character sheets for the pets |
| Store billing fees (15–30%) on a ₹99 price | Accept for reach. Nudge to web or UPI where store policy allows. |
| Exam patterns change | Blueprints are data, with a yearly review checklist |
| Children's data rules (DPDP) | Consent flow, minimal tracking, legal review |
| Brand name not final ("Smriti" domains are taken) | Decide before store submission. Brand strings are config. |
| Voice quality in Hindi and Hinglish | Gemini Live for realtime voice and Deepgram for TTS and STT (owner's choice). Hindi coverage is checked in Phase 0, with a fallback behind the same interface. |
