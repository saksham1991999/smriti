# Smriti — App Flow

Status: Draft v0.1, 28 Oct 2026. This document covers the screens, the navigation, and how the main journeys move through the product. Visual and interaction detail for each screen is in `UX_FLOW.md`.

---

## 1. Navigation map

```mermaid
flowchart TD
  Launch([App launch]) --> Splash
  Splash -->|first run| Onb[Onboarding]
  Splash -->|returning| Home
  Onb --> FirstLesson[First 2-min lesson] --> Home

  subgraph Tabs[Bottom tabs]
    Home[Learn · path + today]
    Labs[Labs · sims, 3D, 360°]
    Practice[Practice · PYQs, mocks]
    Friends[Friends · leagues, duo, squads]
    Me[Me · pet, plant, profile, settings]
  end

  Home --> Subject[Subject map] --> Chapter[Chapter] --> Topic[Topic card]
  Topic -->|Deep Dive| Player[Lesson player]
  Topic -->|Quick Revision| Revise[Revision sheet + rapid cards]
  Home --> Review[Daily review queue]
  Home --> Plan[Today's plan]
  Player --> Tutor[AI tutor sheet]
  Player --> Lab[Sim / 3D / 360° card]
  Practice --> MockLobby[Mock lobby] --> MockRunner[Mock runner] --> Report[Mock report]
  Practice --> PYQ[PYQ bank] --> Player
  Me --> Pet[Pet room]
  Me --> Garden[Plant garden]
  Me --> Settings
  Me --> Paywall
  Anywhere((Any screen)) -.-> Tutor
  Anywhere -.-> Search[Global search]
```

There are five tabs. Learn is always the default tab. The AI tutor and search open from a floating tutor button and the top bar on every main screen.

## 2. Screen inventory

| Area | Screens |
|---|---|
| Entry | Splash, Update prompt (soft/forced), Maintenance |
| Onboarding | Welcome, Language, Goal (exam/class), Exam date, Placement quiz, Daily goal, Pick pet, Name pet, Plant seed, First lesson, Notification ask |
| Auth | Login sheet (phone OTP, Google, Apple, email), OTP entry, Merge progress, Parent consent (for under-13s) |
| Learn | Home, Today's plan, Subject map, Chapter, Topic card, Lesson player, Lesson complete, Review queue, Revision sheet, Cheat sheet, Formula/shortcut vault, Storybook reader, Video lesson |
| Labs | Lab hub, Sim player, 3D viewer, 360° viewer, Periodic table, Fun experiments |
| Memory | Flashcard deck, Memory palace builder, Palace walk, "Make it stick" (AI cue), Confidence stats |
| Practice | Practice hub, Concept drill, PYQ bank, Daily challenge, Mock lobby, Mock instructions, Mock runner, Submit confirm, Mock report, Solutions review, Analytics dashboard |
| AI | Tutor chat, Voice tutor, Photo doubt (camera), Generated story |
| Social | Friends list, Friend profile, Add friends, League, Leaderboards, Duo, Squad, Challenge duel, Shared decks |
| Me | Profile, Pet room, Plant garden, Card album, Badges, Shop (gems), Downloads, PDF export, Settings, Notifications settings, Language, Subscription, Parent mode, Help, Report content |
| Monetisation | Paywall, Trial checkout, Payment status, Manage plan |

## 3. Core journeys

### 3.1 First launch (guest)

```mermaid
sequenceDiagram
  actor S as Student
  participant App
  participant Local as Local store
  participant API
  S->>App: Opens app
  App->>API: GET /config (app variant, flags, min version)
  App->>S: Welcome (pet waves)
  S->>App: Picks language, exam, date, daily goal
  App->>S: Placement quiz (skippable)
  S->>App: Picks cat or dog, names it
  App->>S: Plants the seed animation
  App->>Local: Create guest profile (device id)
  App->>API: POST /guest (anonymous Supabase session)
  App->>S: 2-minute first lesson
  S->>App: Completes it
  App->>S: Plant sprouts, pet celebrates, streak = 1
  App->>S: Pet asks for notification permission
  App->>S: Home
```

In per-exam apps, the exam is preset, so the exam-choice step is skipped.

### 3.2 When login is asked for

```mermaid
flowchart LR
  G[Guest session] --> T{Trigger}
  T -->|3rd lesson done| Soft[Soft sheet: "Save your plant?"]
  T -->|Streak day 2 night| Soft
  T -->|Add friend / join league| Hard[Login required]
  T -->|Start ₹1 trial| Hard
  T -->|Second device| Hard
  Soft -->|Later| G
  Soft -->|Sign in| Auth
  Hard --> Auth[Login sheet]
  Auth --> Merge[Merge guest progress into account]
  Merge --> Back[Return to where they were]
```

Signing in always returns the student to the exact screen they left, so the flow is never broken.

### 3.3 Daily learning loop

```mermaid
flowchart TD
  Open[Open app / tap widget / reminder] --> Home
  Home --> Due{Reviews due?}
  Due -->|yes| Rev[Review queue 3–5 min]
  Due -->|no| Next
  Rev --> Next[Next node on path]
  Next --> Mode{Mode}
  Mode -->|Deep Dive| DD[Lesson player]
  Mode -->|Quick Revision| QR[Revision sheet]
  DD --> Done[Lesson complete: XP, pet + plant reaction]
  QR --> Done
  Done --> Goal{Daily goal met?}
  Goal -->|no| Next
  Goal -->|yes| Celebrate[Streak +1, plant waters, quest progress]
  Celebrate --> Optional[Optional: practice, labs, duel]
```

### 3.4 Lesson player

```mermaid
stateDiagram-v2
  [*] --> Loading
  Loading --> Card: bundle cached or fetched
  Card --> Card: next / prev
  Card --> Question: question card
  Question --> Feedback: answer + confidence tag
  Feedback --> Card: correct
  Feedback --> Hint: wrong (1st)
  Hint --> Question
  Feedback --> Explain: wrong (2nd), show the worked solution and queue the card for review
  Explain --> Card
  Card --> Tutor: ask tutor (sheet)
  Tutor --> Card
  Card --> MakeItStick: "Make it stick"
  MakeItStick --> Card
  Card --> Complete: last card
  Complete --> [*]
```

- The student can exit at any point, and progress is saved per card.
- On resume, the lesson reopens at the last card.

### 3.5 Mock test

```mermaid
flowchart TD
  Lobby[Mock lobby: exam, type, history] --> Instr[Instructions in NTA/SSC style, language choice]
  Instr --> Run[Mock runner]
  Run --> Sec{Blueprint rules}
  Sec -->|Sectional timers| Lock[Auto-move to next section at time-up]
  Sec -->|Free switching| Free[Palette jump across sections]
  Run --> Palette[Question palette: not visited / not answered / answered / marked / answered+marked]
  Run -->|Time up| Auto[Auto-submit]
  Run -->|Submit| Confirm[Summary of attempts and confirm]
  Confirm --> Report
  Auto --> Report[Report: score, rank, percentile]
  Report --> Time[Time analysis]
  Report --> Concept[Concept heat map]
  Report --> Conf[Confidence analysis]
  Report --> Sol[Solutions review]
  Report --> Fix[Auto revision plan, sent to the review queue]
```

The mock runner keeps working offline once the paper has downloaded. Answers and per-question timings are written locally every 5 seconds and synced on submit. A crash or call interruption resumes the mock with the timer intact. For live mocks, the timer follows server time.

### 3.6 Streak, plant and pet lifecycle

```mermaid
stateDiagram-v2
  direction LR
  state Plant {
    Seed --> Sprout: day 1
    Sprout --> Sapling: day 7
    Sapling --> Budding: day 21
    Budding --> Flowering: day 50
    Flowering --> Tree: day 100
  }
  state Health {
    Thriving --> Droopy: 1 missed day
    Droopy --> Dry: 3 missed days
    Dry --> Wilted: 7 missed days
    Wilted --> Dormant: 21 missed days
    Droopy --> Thriving: study 1 day
    Dry --> Thriving: study 2 days
    Wilted --> Thriving: study 3 days (revival quest)
    Dormant --> Thriving: 5-day revival quest, growth stage kept
  }
```

- **Plant.** The growth stage comes from the total of study days, so it is never lost. The health state comes from recency. A streak freeze stops health from dropping for a day.
- **Pet.** It uses the same recency model, shown as mood (happy, content, sleepy, sad, unwell, resting) and energy. Care actions speed up recovery: a lesson, a review, or a "feed" bought with XP. The pet never dies. Under-10 mode stops at "sleepy".
- All of these states are calculated on the server from activity days in the student's timezone. The app shows a predicted state while offline.

### 3.7 Upgrade to Pro

```mermaid
flowchart TD
  Gate[Hit a Pro gate: deep dive lock, 6th tutor message, PDF export...] --> Paywall
  Paywall[Paywall: pet holds the ₹1 offer] --> Plat{Platform}
  Plat -->|Android| Play[Google Play Billing intro offer ₹1]
  Plat -->|iOS| SK[StoreKit intro offer ₹1]
  Plat -->|Web| RZ[Razorpay subscription with UPI Autopay mandate]
  Play --> RC[RevenueCat webhook]
  SK --> RC
  RZ --> BE[Backend webhook]
  RC --> BE
  BE --> Ent[Entitlement = pro on account]
  Ent --> Unlock[Celebration and unlock, back to the gated item]
```

If the student isn't logged in, the login sheet appears before checkout.

### 3.8 AI tutor and image generation

```mermaid
sequenceDiagram
  actor S as Student
  participant App
  participant API as FastAPI
  participant LLM
  participant Agnes as Agnes AI
  participant R2 as R2 + CDN
  S->>App: Ask "why does the ball curve?"
  App->>API: POST /tutor/messages (card context, mastery, locale)
  API->>LLM: prompt + tools [search_content, generate_image, make_flashcard]
  LLM-->>API: tool call generate_image(style=sunny, prompt)
  API->>R2: check prompt-hash cache
  alt cache miss
    API->>Agnes: generate
    Agnes-->>API: image
    API->>R2: store as webp
  end
  API-->>App: streamed answer + image URL
  App->>S: Answer with an illustrated diagram
```

### 3.9 App variants

```mermaid
flowchart LR
  Build[EAS build with APP_VARIANT] --> Cfg[app.config.ts reads variants/jee.json]
  Cfg --> Bin[Binary: name, bundle id, icon, accent, exam_profile]
  Bin --> Run[Runtime: /config?variant=jee]
  Run --> Filter[Content API filters by exam profile]
```

The all-exams app shows an exam switcher. A per-exam app hides the switcher, shows "Also try Smriti NEET" cross-promotion in settings, and shares the same account and Pro entitlement.

### 3.10 Offline and sync
- Content bundles and media are cached with a version and evicted least-recently-used first. Downloads that the student picks are pinned.
- Progress events (lesson progress, answers, reviews, timings) go to an outbox and are sent to `/sync` in batches with idempotency keys.
- Conflict rules: events are append-only, so a merge is a union. Mastery and spaced-repetition state are recalculated on the server from events.

## 4. Deep links

| Link | Opens |
|---|---|
| `smriti.app/t/{topicSlug}` | Topic card (and the web topic page if the app isn't installed) |
| `smriti.app/mock/{mockId}` | Mock lobby |
| `smriti.app/duel/{code}` | Join a challenge duel |
| `smriti.app/invite/{code}` | Referral (both get a free week) |
| `smriti.app/review` | Review queue (used by notifications and widgets) |

Each per-exam app registers its own domain path prefix, for example `/jee/`.
