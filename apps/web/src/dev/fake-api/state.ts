/**
 * FAKE API state and server-side folds. Stands in for apps/api until it lands: it keeps users,
 * identities and events, and recomputes streak, plant, pet, wallet, topic progress and the FSRS
 * mirror from events with app-core's own rules (TRD §10), the way the real server does.
 */
import {
  EMPTY_STREAK,
  NEW_PLANT,
  activityByDay,
  addDays,
  closePlantDay,
  derivePetState,
  gemsForStreakMilestone,
  grantMonthlyFreezes,
  localDate,
  milestonesCrossed,
  moodBand,
  nextStageAt,
  qualifiesDay,
  rollPlant,
  rollStreak,
  streakView,
  type AgeBand,
  type EntitlementSection,
  type SyncEventPayloads,
  type SyncStateResponse,
  type WireEvent,
} from "@smriti/app-core";

export interface FakeUser {
  id: string;
  isAnonymous: boolean;
  email: string | null;
  name: string | null;
  createdAt: number;
  deletedAt: number | null;
  version: number;
  locale: "en" | "hi";
  events: WireEvent[];
  entitlement: EntitlementSection;
  introClaimed: boolean;
  guardianConsent: boolean;
}

export interface FakeDbData {
  users: Record<string, FakeUser>;
  refresh: Record<string, string>;
  mergeIntents: Record<string, { guestId: string; email: string }>;
  checkouts: Record<string, { userId: string; intro: boolean; amount: number }>;
}

export const emptyDb = (): FakeDbData => ({ users: {}, refresh: {}, mergeIntents: {}, checkouts: {} });

const latestTz = (u: FakeUser) => u.events.at(-1)?.tz ?? "Asia/Kolkata";

function payloadsOf<T extends keyof SyncEventPayloads>(u: FakeUser, type: T): { e: WireEvent; p: SyncEventPayloads[T] }[] {
  return u.events.filter((e) => e.type === type).map((e) => ({ e, p: e.payload as SyncEventPayloads[T] }));
}

function ageBandFrom(u: FakeUser, now: number): AgeBand | null {
  let band: AgeBand | null = null;
  for (const { p } of payloadsOf(u, "onboarding_answer")) {
    if (p.step === "class" && typeof p.value === "number") band = p.value <= 5 ? "u10" : p.value <= 7 ? "10_12" : "13_17";
    if (p.step === "birth_year") {
      if (p.value === "prefer_not") band = "13_17";
      else if (typeof p.value === "number") {
        const age = new Date(now).getUTCFullYear() - p.value;
        band = age >= 19 ? "18p" : age >= 13 ? "13_17" : age >= 10 ? "10_12" : "u10";
      }
    }
  }
  for (const { p } of payloadsOf(u, "settings_changed")) if (p.key === "age_band" && typeof p.value === "string") band = p.value as AgeBand;
  return band;
}

/** Recomputes everything the client shows from the user's events. */
export function computeState(u: FakeUser, now: number): SyncStateResponse {
  const tz = latestTz(u);
  const today = localDate(now, tz);
  const yesterday = addDays(today, -1);
  const days = activityByDay(u.events, tz);
  const firstDay = [...days.keys()].sort()[0] ?? null;
  const todayAct = days.get(today);
  const todayQualified = todayAct ? qualifiesDay(todayAct) : false;
  const isPro = u.entitlement.plan === "pro";

  // Streak: grant the month's freeze, close every past day, then the live view for today.
  const pastInputs = [...days.entries()].filter(([d]) => d < today).map(([day, a]) => ({ day, qualified: qualifiesDay(a) }));
  let streakState = grantMonthlyFreezes({ ...EMPTY_STREAK }, firstDay ?? today, isPro);
  if (firstDay && firstDay < today) streakState = rollStreak({ ...streakState, closedThrough: addDays(firstDay, -1) }, pastInputs, yesterday).state;
  const view = streakView(streakState, today, { qualified: todayQualified });

  // Plant: seeded by the plant_seeded event; growth from study days.
  const seeded = u.events.some((e) => e.type === "plant_seeded");
  let plant = { ...NEW_PLANT };
  if (seeded && firstDay) {
    const plantInputs = [...days.entries()].filter(([d]) => d < today).map(([day, a]) => ({ day, qualified: qualifiesDay(a), rescue: a.rescueDone }));
    if (firstDay < today) plant = rollPlant({ ...plant, closedThrough: addDays(firstDay, -1) }, plantInputs, yesterday).state;
    if (todayQualified) plant = closePlantDay(plant, { day: today, qualified: true }).state;
  }

  // Pet: named in onboarding; mood sits in the band of the plant's health.
  const named = payloadsOf(u, "pet_named").at(-1)?.p;
  const [lo, hi] = moodBand(plant.health);
  const mood = Math.round((lo + hi) / 2);
  const energy = 70;
  const pet = named ? { species: named.species, name: named.name, mood, energy, state: derivePetState({ mood, energy }) } : null;

  // Wallet: XP from lessons; gems from streak milestones crossed.
  const lessons = payloadsOf(u, "lesson_completed");
  const xpTotal = lessons.reduce((a, { p }) => a + p.xp, 0);
  const xpToday = lessons.filter(({ e }) => localDate(e.occurred_at, tz) === today).reduce((a, { p }) => a + p.xp, 0);
  const gems = milestonesCrossed(0, view.longest, [3, 7, 14, 30, 50, 100]).reduce((a, d) => a + gemsForStreakMilestone(d), 0);

  // Profile from onboarding answers and settings.
  const goal = payloadsOf(u, "onboarding_answer").filter(({ p }) => p.step === "goal").at(-1)?.p.value;
  const dailyGoal = payloadsOf(u, "onboarding_answer").filter(({ p }) => p.step === "daily_goal").at(-1)?.p.value;
  let locale = u.locale;
  for (const { p } of payloadsOf(u, "settings_changed")) if (p.key === "locale" && (p.value === "en" || p.value === "hi")) locale = p.value;
  const goalSetting = payloadsOf(u, "settings_changed").filter(({ p }) => p.key === "daily_goal_minutes").at(-1)?.p.value;

  // Topic progress.
  const progress = new Map<string, { status: "in_progress" | "learned"; percent: number }>();
  for (const { p } of payloadsOf(u, "lesson_started")) if (!progress.has(p.topic_id)) progress.set(p.topic_id, { status: "in_progress", percent: 10 });
  for (const { p } of lessons) progress.set(p.topic_id, { status: "learned", percent: 100 });

  // FSRS mirror: the latest client state per card (the real server re-runs FSRS; same parameters).
  const srs = new Map<string, SyncStateResponse["srs"] extends infer S ? (S extends { cards: (infer C)[] } ? C : never) : never>();
  for (const { p } of payloadsOf(u, "review_rated")) {
    srs.set(p.card_ref, {
      card_ref: p.card_ref,
      due: p.fsrs_state.due,
      stability: p.fsrs_state.stability,
      difficulty: p.fsrs_state.difficulty,
      state: p.fsrs_state.state,
      reps: p.fsrs_state.reps,
      lapses: p.fsrs_state.lapses,
      last_review: null,
      scheduled_days: p.fsrs_state.scheduled_days,
      elapsed_days: p.fsrs_state.elapsed_days,
    });
  }

  return {
    state_version: u.version,
    profile: {
      id: u.id,
      display_name: u.isAnonymous ? null : u.name,
      locale,
      is_guest: u.isAnonymous,
      age_band: ageBandFrom(u, now),
      exam_profile_ids: Array.isArray(goal) ? goal.map(String) : typeof goal === "string" ? [goal] : [],
      daily_goal_minutes: typeof goalSetting === "number" ? goalSetting : typeof dailyGoal === "number" ? dailyGoal : 10,
      timezone: tz,
    },
    streak: {
      current: view.current,
      longest: view.longest,
      today_qualified: view.todayQualified,
      freezes_equipped: view.freezesEquipped,
      freezes_available: view.freezesPending,
      rest_day: null,
      at_risk: view.atRisk,
    },
    plant: { stage: plant.stage, health: plant.health, study_days: plant.growthPoints, next_stage_at: nextStageAt(plant.growthPoints) },
    pet,
    wallet: { xp_total: xpTotal, xp_today: xpToday, gems },
    srs: { cards: [...srs.values()], deleted: [] },
    topic_progress: [...progress.entries()].map(([topic_id, v]) => ({ topic_id, ...v })),
    entitlement: u.entitlement,
  };
}

/** Sync contract v1.2 answer contexts (`check` and `fix` are new in v1.2). */
export const ANSWER_CONTEXTS = new Set(["lesson", "check", "fix", "practice", "review", "challenge", "chapter_test"]);

/** Accepts or rejects one wire event (the server's validation, simplified). */
export function validateEvent(e: WireEvent): string | null {
  if (!e.event_id || !/^[0-9a-f-]{36}$/.test(e.event_id)) return "invalid_event_id";
  if (!e.tz) return "missing_tz";
  if (Number.isNaN(Date.parse(e.occurred_at))) return "invalid_time";
  if (e.type === "answer_submitted") {
    const p = e.payload as SyncEventPayloads["answer_submitted"];
    if (typeof p.response === "string" && p.response.length > 64) return "free_text_not_allowed";
    if (!ANSWER_CONTEXTS.has(String(p.context))) return "invalid_payload";
    if (!("card_id" in p) && !("question_id" in p)) return "invalid_payload";
  }
  if (e.type === "pet_named") {
    const p = e.payload as SyncEventPayloads["pet_named"];
    if (!p.name || p.name.length > 12) return "invalid_payload";
  }
  return null;
}
