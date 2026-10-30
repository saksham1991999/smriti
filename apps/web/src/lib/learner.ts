/**
 * Learning actions. Lesson events come from @smriti/lesson-core's session as ready envelopes and go
 * to the outbox with their local rows in one transaction (DB_SCHEMA §15). The store is updated
 * optimistically so LES-08 and Home render at once; the server recomputes everything from events
 * and its state replaces these copies on the next sync (server wins).
 */
import {
  nextStageAt,
  stageForPoints,
  type Confidence,
  type Json,
  type NewOutboxRow,
  type PetSection,
  type PlantSection,
  type ReviewRating,
  type SrsCardRow,
  type StorageTables,
  type StreakSection,
  type WalletSection,
} from "@smriti/app-core";
import type { TypedBundle } from "@smriti/content-schema";
import { visibleBites, type EventEnvelope, type LessonPlan, type LessonState } from "@smriti/lesson-core";
import type { Services } from "../boot/services";
import { useDaily } from "./daily";
import { useOnboarding } from "./onboarding";

const EMPTY_STREAK: StreakSection = { current: 0, longest: 0, today_qualified: false, freezes_equipped: 1, freezes_available: 0, rest_day: null, at_risk: false };
const EMPTY_PLANT: PlantSection = { stage: "seed", health: "thriving", study_days: 0, next_stage_at: 1 };
const EMPTY_WALLET: WalletSection = { xp_total: 0, xp_today: 0, gems: 0 };


async function putSnapshot(tx: StorageTables, key: string, data: unknown) {
  await tx.profile_snapshot.put({ key, data: data as Json, updated_at: new Date().toISOString() });
}

/**
 * The wire context for an answer (sync contract v1.2): checks send `check`, Fix mistakes `fix`.
 * lesson-core emits `lesson` for every mode today, so the host maps it here.
 */
export function wireContext(plan: LessonPlan): "lesson" | "check" | "fix" {
  return plan.mode === "quick_check" ? "check" : plan.mode === "fix_mistakes" ? "fix" : "lesson";
}

export function toOutboxRow(e: EventEnvelope, plan: LessonPlan): NewOutboxRow {
  const payload = e.type === "answer_submitted" ? { ...e.payload, context: wireContext(plan) } : e.payload;
  return { event_id: e.event_id, type: e.type, payload, occurred_at: e.occurred_at, tz: e.tz } as NewOutboxRow;
}

/** Writes one lesson-core event (and the topic's in-progress row on start). */
export async function recordLessonEvent(s: Services, e: EventEnvelope, plan: LessonPlan) {
  await s.recordEnvelopes([toOutboxRow(e, plan)], async (tx) => {
    if (e.type !== "lesson_started") return;
    const existing = await tx.topic_status.get(plan.topicId);
    if (!existing || existing.status === "not_started") {
      await tx.topic_status.put({ topic_id: plan.topicId, status: "in_progress", learned_via: null, percent: 10, updated_at: new Date().toISOString() });
    }
  });
  if (e.type === "lesson_started") s.analytics.track("lesson_started", { topic_id: plan.topicId, mode: plan.mode });
}

/** Saves where to resume (learn §7.3 rule 1). No event: progress is local until the lesson ends. */
export async function saveProgress(s: Services, plan: LessonPlan, lastCardIndex: number) {
  if (plan.mode !== "deep_dive" && plan.mode !== "quick_revision") return;
  const mode = plan.mode;
  const prev = await s.storage.lesson_progress.get(`${plan.topicId}|${mode}`);
  await s.storage.lesson_progress.put({
    topic_id: plan.topicId,
    mode,
    bundle_hash: plan.bundleVersion,
    last_card_index: lastCardIndex,
    cards_seen: Math.max(prev?.cards_seen ?? 0, lastCardIndex + 1),
    bites_completed: prev?.bites_completed ?? [],
    best_score: prev?.best_score ?? null,
    completed_at: prev?.completed_at ?? null,
    updated_at: new Date().toISOString(),
  });
}

export interface LessonOutcome {
  xp: number;
  streakBefore: number;
  streakAfter: number;
  firstOfDay: boolean;
  plantBefore: PlantSection;
  plantAfter: PlantSection;
  accuracy: number | null;
  minutes: number;
  cardsSeen: number;
  lessonsCompleted: number;
  topicLearned: boolean;
  nextBiteId: string | null;
  missed: number;
}

/**
 * LES-08: the lesson finished (lesson_completed already went to the outbox through onEvent). Marks
 * the bite done, the topic learned when every bite is, queues question and summary cards for
 * review (missed ones due now), applies Quick Revision self-ratings with FSRS on the device, and
 * moves streak, plant and wallet optimistically.
 */
export async function finishLesson(s: Services, args: { plan: LessonPlan; state: LessonState; bundle: TypedBundle }): Promise<LessonOutcome> {
  const { plan, state, bundle } = args;
  const summary = state.summary!;
  const now = new Date();
  const st = s.store.getState();
  const streakBefore = st.streak ?? EMPTY_STREAK;
  const plantBefore = st.plant ?? EMPTY_PLANT;
  const counts = plan.lessonEvents;
  const firstOfDay = counts && !streakBefore.today_qualified;
  const streak: StreakSection = firstOfDay
    ? { ...streakBefore, current: streakBefore.current + 1, longest: Math.max(streakBefore.longest, streakBefore.current + 1), today_qualified: true, at_risk: false }
    : streakBefore;
  const studyDays = firstOfDay ? plantBefore.study_days + 1 : plantBefore.study_days;
  const plant: PlantSection = { ...plantBefore, study_days: studyDays, stage: stageForPoints(studyDays), next_stage_at: nextStageAt(studyDays), health: firstOfDay ? "thriving" : plantBefore.health };
  const walletBefore = st.wallet ?? EMPTY_WALLET;
  const wallet: WalletSection = { ...walletBefore, xp_total: walletBefore.xp_total + summary.xp, xp_today: walletBefore.xp_today + summary.xp };

  const bites = visibleBites(bundle, null);
  const mode = plan.mode === "quick_revision" ? "quick_revision" : "deep_dive";
  let topicLearned = false;
  let nextBiteId: string | null = null;
  const reviewEvents: NewOutboxRow[] = [];

  await s.storage.transaction(async (tx) => {
    const key = `${plan.topicId}|${mode}`;
    const prev = await tx.lesson_progress.get(key);
    const done = new Set(prev?.bites_completed ?? []);
    if (plan.biteId) done.add(plan.biteId);
    const allDone = plan.mode === "quick_revision" || bites.every((b) => done.has(b.id));
    nextBiteId = plan.mode === "deep_dive" || plan.mode === "onboarding" ? (bites.find((b) => !done.has(b.id))?.id ?? null) : null;
    await tx.lesson_progress.put({
      topic_id: plan.topicId,
      mode,
      bundle_hash: plan.bundleVersion,
      last_card_index: 0,
      cards_seen: (prev?.cards_seen ?? 0) + summary.cardsSeen,
      bites_completed: [...done],
      best_score: summary.accuracy === null ? (prev?.best_score ?? null) : Math.max(prev?.best_score ?? 0, Math.round(summary.accuracy * 100)),
      completed_at: allDone ? now.toISOString() : (prev?.completed_at ?? null),
      updated_at: now.toISOString(),
    });
    if (counts) {
      const status = await tx.topic_status.get(plan.topicId);
      topicLearned = allDone || status?.status === "learned";
      await tx.topic_status.put({
        topic_id: plan.topicId,
        status: topicLearned ? "learned" : "in_progress",
        learned_via: topicLearned ? (status?.learned_via ?? "lesson") : null,
        percent: topicLearned ? 100 : Math.round((done.size / Math.max(1, bites.length)) * 100),
        updated_at: now.toISOString(),
      });
    }

    // Review queue (memory-labs §5.1): question and summary cards; missed ones are due now.
    const missedRefs = new Set(state.reviewQueue.map((r) => r.cardRef));
    const refs = plan.cards
      .filter((c) => c.question || c.card?.type === "summary")
      .map((c) => ({ ref: c.cardId && !c.passage ? `c:${c.cardId}` : `q:${c.question?.id ?? c.key}`, c }));
    const existing = new Map((await tx.srs_cards.getMany(refs.map((r) => r.ref))).map((x) => [x.card_ref, x]));
    const rows: SrsCardRow[] = [];
    for (const { ref, c } of refs) {
      if (existing.has(ref)) continue;
      const row = s.srs.newCard(ref, now, { topic_id: c.topicId, concept_ids: c.concepts, introduced_on: now.toISOString().slice(0, 10) });
      rows.push(missedRefs.has(ref) ? { ...row, due_at: now.toISOString() } : row);
    }
    await tx.srs_cards.putMany(rows);
    await tx.cards_index.putMany(refs.filter((r) => r.c.cardId).map((r) => ({ card_id: r.c.cardId as string, bundle_id: bundle.id, topic_id: r.c.topicId, concept_ids: r.c.concepts })));

    // Quick Revision self-ratings and result ratings go through FSRS on the device (R18).
    for (const { cardRef, rating } of state.ratings) {
      const row = existing.get(cardRef) ?? rows.find((r) => r.card_ref === cardRef);
      if (!row) continue;
      const res = s.srs.schedule(row, rating, now);
      await tx.srs_cards.put(res.card);
      const ev = s.outbox.create("review_rated", { card_ref: cardRef, rating, confidence: null, ms_to_answer: 0, fsrs_state: res.fsrsState });
      reviewEvents.push(ev);
      await tx.outbox.append(ev);
    }
    if (counts) {
      await putSnapshot(tx, "streak", streak);
      await putSnapshot(tx, "plant", plant);
      await putSnapshot(tx, "wallet", wallet);
    }
  });
  if (counts) s.store.setState({ streak, plant, wallet });
  useDaily.getState().add(summary.msTotal);
  if (reviewEvents.length) void s.sync.flush();
  const lessonsCompleted = useOnboarding.getState().lessonsCompleted + (counts ? 1 : 0);
  useOnboarding.getState().update({ lessonsCompleted });
  s.analytics.track("lesson_completed", { topic_id: plan.topicId, mode: plan.mode, xp_estimate: summary.xp, cards_seen: String(summary.cardsSeen), lesson_count: lessonsCompleted });
  return {
    xp: summary.xp,
    streakBefore: streakBefore.current,
    streakAfter: streak.current,
    firstOfDay,
    plantBefore,
    plantAfter: plant,
    accuracy: summary.accuracy === null ? null : Math.round(summary.accuracy * 100),
    minutes: Math.max(1, Math.round(summary.msTotal / 60_000)),
    cardsSeen: summary.cardsSeen,
    lessonsCompleted,
    topicLearned,
    nextBiteId,
    missed: summary.missed.length,
  };
}

/** ONB-10: the pet exists locally at once; `pet_named` carries it to the server. */
export async function namePet(s: Services, species: "cat" | "dog", name: string) {
  const pet: PetSection = { species, name, mood: 80, energy: 70, state: "happy" };
  await s.record("pet_named", { species, name }, (tx) => putSnapshot(tx, "pet", pet));
  s.store.setState({ pet });
}

/** ONB-12: one tap plants the seed. */
export async function plantSeed(s: Services) {
  const plant = s.store.getState().plant ?? EMPTY_PLANT;
  await s.record("plant_seeded", {}, (tx) => putSnapshot(tx, "plant", plant));
  s.store.setState({ plant, streak: s.store.getState().streak ?? EMPTY_STREAK, wallet: s.store.getState().wallet ?? EMPTY_WALLET });
}

/** MEM-03: rates a review card with FSRS on the device; the event carries the client's state. */
export async function rateCard(s: Services, row: SrsCardRow, rating: ReviewRating, confidence: Confidence | null, ms: number) {
  const result = s.srs.schedule(row, rating, new Date());
  await s.record(
    "review_rated",
    { card_ref: row.card_ref, rating, confidence, ms_to_answer: Math.round(ms), fsrs_state: result.fsrsState },
    (tx) => tx.srs_cards.put(result.card),
  );
  useDaily.getState().add(ms);
  return result.card;
}
