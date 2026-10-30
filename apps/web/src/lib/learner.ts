/**
 * Learning actions: each writes local rows and its sync event in one transaction (DB_SCHEMA §15),
 * then updates the store optimistically so LES-08 and Home render at once. The server recomputes
 * everything from events and its state replaces these copies on the next sync (server wins).
 */
import {
  nextStageAt,
  stageForPoints,
  toFsrsStatePayload,
  type Confidence,
  type Json,
  type LessonMode,
  type PetSection,
  type PlantSection,
  type ReviewRating,
  type SrsCardRow,
  type StorageTables,
  type StreakSection,
  type WalletSection,
} from "@smriti/app-core";
import type { AnswerRecord, Lesson, LessonResult, PlayerConfidence } from "@smriti/lesson-player-web";
import type { Services } from "../boot/services";
import { useOnboarding } from "./onboarding";

export const wireConfidence = (c: PlayerConfidence | null): Confidence | null => (c === "half" ? "fifty_fifty" : c);

const EMPTY_STREAK: StreakSection = { current: 0, longest: 0, today_qualified: false, freezes_equipped: 1, freezes_available: 0, rest_day: null, at_risk: false };
const EMPTY_PLANT: PlantSection = { stage: "seed", health: "thriving", study_days: 0, next_stage_at: 1 };
const EMPTY_WALLET: WalletSection = { xp_total: 0, xp_today: 0, gems: 0 };

/** XP for a lesson: 10 per first-try right answer, 5 on the second try, plus 5 for finishing (owner flag later). */
export function lessonXp(r: LessonResult): number {
  return r.firstTry * 10 + (r.correct - r.firstTry) * 5 + 5;
}

async function putSnapshot(tx: StorageTables, key: string, data: unknown) {
  await tx.profile_snapshot.put({ key, data: data as Json, updated_at: new Date().toISOString() });
}

export async function startLesson(s: Services, lesson: Lesson, mode: LessonMode, locale: "en" | "hi") {
  s.analytics.track("lesson_started", { topic_id: lesson.topicId, mode });
  await s.record("lesson_started", { topic_id: lesson.topicId, mode, bundle_version: lesson.bundleVersion, locale }, async (tx) => {
    const existing = await tx.topic_status.get(lesson.topicId);
    if (!existing || existing.status === "not_started") {
      await tx.topic_status.put({ topic_id: lesson.topicId, status: "in_progress", learned_via: null, percent: 10, updated_at: new Date().toISOString() });
    }
  });
}

export function recordCardViewed(s: Services, topicId: string, cardId: string, index: number, ms: number) {
  void s.record("lesson_card_viewed", { topic_id: topicId, card_id: cardId, index, ms_on_card: Math.round(ms) });
}

export function recordAnswer(s: Services, topicId: string, a: AnswerRecord) {
  const response = a.response === null ? "dont_know" : a.response;
  void s.record("answer_submitted", {
    topic_id: topicId,
    card_id: a.card.id,
    context: "lesson",
    response,
    correct: a.correct,
    attempt: a.attempt,
    confidence: wireConfidence(a.confidence),
    ms_to_answer: Math.round(a.msToAnswer),
  });
}

export interface LessonOutcome {
  xp: number;
  streakBefore: number;
  streakAfter: number;
  firstOfDay: boolean;
  plantBefore: PlantSection;
  plantAfter: PlantSection;
  accuracy: number;
  minutes: number;
  lessonsCompleted: number;
}

/** LES-08: records `lesson_completed`, marks the topic learned, queues its question cards for review. */
export async function completeLesson(s: Services, lesson: Lesson, mode: LessonMode, r: LessonResult): Promise<LessonOutcome> {
  const xp = lessonXp(r);
  const st = s.store.getState();
  const streakBefore = st.streak ?? EMPTY_STREAK;
  const plantBefore = st.plant ?? EMPTY_PLANT;
  const firstOfDay = !streakBefore.today_qualified;
  const streak: StreakSection = firstOfDay
    ? { ...streakBefore, current: streakBefore.current + 1, longest: Math.max(streakBefore.longest, streakBefore.current + 1), today_qualified: true, at_risk: false }
    : streakBefore;
  const studyDays = firstOfDay ? plantBefore.study_days + 1 : plantBefore.study_days;
  const plant: PlantSection = { ...plantBefore, study_days: studyDays, stage: stageForPoints(studyDays), next_stage_at: nextStageAt(studyDays), health: firstOfDay ? "thriving" : plantBefore.health };
  const walletBefore = st.wallet ?? EMPTY_WALLET;
  const wallet: WalletSection = { ...walletBefore, xp_total: walletBefore.xp_total + xp, xp_today: walletBefore.xp_today + xp };
  const now = new Date();

  await s.record(
    "lesson_completed",
    { topic_id: lesson.topicId, mode, cards_seen: r.cardsSeen, correct: r.correct, total: r.total, ms_total: Math.round(r.msTotal), xp },
    async (tx) => {
      await tx.topic_status.put({ topic_id: lesson.topicId, status: "learned", learned_via: "lesson", percent: 100, updated_at: now.toISOString() });
      // Each question card enters the review queue (memory-labs §5.1); missed ones are due sooner.
      const rows: SrsCardRow[] = lesson.cards
        .filter((c) => c.type === "mcq" || c.type === "numeric")
        .map((c) => s.srs.newCard(`c:${c.id}`, now, { topic_id: lesson.topicId, concept_ids: [], introduced_on: now.toISOString().slice(0, 10) }));
      const existing = new Set((await tx.srs_cards.getMany(rows.map((x) => x.card_ref))).map((x) => x.card_ref));
      await tx.srs_cards.putMany(rows.filter((x) => !existing.has(x.card_ref)));
      await tx.cards_index.putMany(
        lesson.cards.filter((c) => c.type === "mcq" || c.type === "numeric").map((c) => ({ card_id: c.id, bundle_id: lesson.bundleVersion, topic_id: lesson.topicId, concept_ids: [] })),
      );
      await putSnapshot(tx, "streak", streak);
      await putSnapshot(tx, "plant", plant);
      await putSnapshot(tx, "wallet", wallet);
    },
  );
  s.store.setState({ streak, plant, wallet });
  const lessonsCompleted = useOnboarding.getState().lessonsCompleted + 1;
  useOnboarding.getState().update({ lessonsCompleted });
  s.analytics.track("lesson_completed", { topic_id: lesson.topicId, mode, xp });
  return {
    xp,
    streakBefore: streakBefore.current,
    streakAfter: streak.current,
    firstOfDay,
    plantBefore,
    plantAfter: plant,
    accuracy: r.total ? Math.round((r.correct / r.total) * 100) : 100,
    minutes: Math.max(1, Math.round(r.msTotal / 60_000)),
    lessonsCompleted,
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
    { card_ref: row.card_ref, rating, confidence, ms_to_answer: Math.round(ms), fsrs_state: toFsrsStatePayload(result.row) },
    (tx) => tx.srs_cards.put(result.row),
  );
  return result.row;
}
