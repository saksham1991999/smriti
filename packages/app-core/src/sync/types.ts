/**
 * Wire types of the client ↔ API sync contract (`docs/contracts/sync.md`, v1).
 * The API's Pydantic models are the source of truth; keep these in step with them.
 */
import type { PalaceDoc } from '../palace/types';

export type Locale = 'en' | 'hi';
export type Confidence = 'sure' | 'fifty_fifty' | 'guess';
export type LessonMode = 'deep_dive' | 'quick_revision' | 'onboarding' | 'quick_check';
/** `mock`: an answer in a submitted mock attempt (contract v1.3); it carries `attempt_id`. */
export type AnswerContext = 'lesson' | 'practice' | 'review' | 'challenge' | 'chapter_test' | 'mock';
export type ReviewRating = 1 | 2 | 3 | 4;
export type AgeBand = 'u10' | '10_12' | '13_17' | '18p';

/** The client's FSRS state sent with each rating (`review_rated.fsrs_state`). */
export interface FsrsStatePayload {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: 0 | 1 | 2 | 3;
}

export interface SyncEventPayloads {
  lesson_started: { topic_id: string; mode: LessonMode; bundle_version: string; locale: Locale };
  lesson_card_viewed: { topic_id: string; card_id: string; index: number; ms_on_card: number };
  answer_submitted: {
    topic_id: string;
    card_id?: string;
    question_id?: string;
    context: AnswerContext;
    /** Option ids, a number or a text key: never free text typed by the student. */
    response: string[] | number | string;
    correct: boolean;
    attempt: 1 | 2;
    confidence: Confidence | null;
    ms_to_answer: number;
    /** The submitted mock attempt; required with `context: 'mock'` (with `question_id`). */
    attempt_id?: string;
  };
  lesson_completed: {
    topic_id: string;
    mode: LessonMode;
    cards_seen: number;
    correct: number;
    total: number;
    ms_total: number;
    xp: number;
  };
  review_rated: {
    /** `c:<card_id>`, `d:<user_card_id>`, `q:<question_id>` or (v1.5) `p:<palace_item_id>`. */
    card_ref: string;
    rating: ReviewRating;
    confidence: Confidence | null;
    ms_to_answer: number;
    fsrs_state: FsrsStatePayload;
  };
  practice_session_completed: {
    session_id: string;
    kind: 'drill' | 'pyq' | 'weak_spots';
    answered: number;
    correct: number;
    ms_total: number;
  };
  daily_challenge_completed: { challenge_date: string; score: number; ms_total: number };
  mock_section_submitted: { attempt_id: string; section_code: string };
  pet_care: { action: 'pet' | 'feed' | 'play'; item_id?: string };
  pet_named: { species: 'cat' | 'dog'; name: string };
  plant_seeded: Record<string, never>;
  onboarding_answer: {
    step: 'goal' | 'class' | 'birth_year' | 'exam_date' | 'level' | 'daily_goal' | 'reminder';
    value: string | number | boolean | string[];
  };
  settings_changed: { key: string; value: string | number | boolean | null };
  deck_card_upserted: { user_card_id: string; deck_id: string; front: unknown; back: unknown };
  deck_card_deleted: { user_card_id: string };
  focus_session_completed: { minutes: number; rounds: number };
  quest_claimed: { quest_id: string };
  freeze_equipped: { slot: number };

  /** The 2-minute rescue (R23, memory-labs §5.13). */
  rescue_completed: { cards: number; ms_total: number };
  /** memory-labs §5.14: ids only. */
  cards_queued: { concept_ids: string[]; source: CardsQueuedSource };
  /** memory-labs §5.2. */
  comeback_plan_started: { days_away: number; cards: number };
  /**
   * (v1.4) A little learner finished a story, song or play activity (lesson-core
   * `ActivityCompletion`, see `activityCompletedPayload`). Ids and counts only, no free text.
   */
  activity_completed: {
    kind: LittleActivityCompletionKind;
    activity_id: string;
    topic_id: string;
    concept_ids: string[];
    bundle_version: string;
    locale: Locale;
    stars: number;
    ms_total: number;
    completed_at: string;
  };
  /**
   * (v1.5) A memory palace, whole (see `palace/types.ts`). The server keeps the newest
   * `updated_at`; build it with `palaceSavedPayload` and enqueue it with `enqueuePalaceSaved`.
   */
  palace_saved: PalaceDoc;
  /** (v1.5) A deleted palace stays deleted. */
  palace_deleted: { palace_id: string };
}

/** The activity kinds with a completion event (lesson-core `ActivityKind`). */
export type LittleActivityCompletionKind = 'story' | 'song' | 'play';

/** `cards_queued.source` on the wire (sync contract v1.1). */
export type CardsQueuedSource = 'lesson' | 'practice' | 'comeback';

export type SyncEventType = keyof SyncEventPayloads;

export const CONTRACT_V1_EVENT_TYPES = [
  'lesson_started',
  'lesson_card_viewed',
  'answer_submitted',
  'lesson_completed',
  'review_rated',
  'practice_session_completed',
  'daily_challenge_completed',
  'mock_section_submitted',
  'pet_care',
  'pet_named',
  'plant_seeded',
  'onboarding_answer',
  'settings_changed',
  'deck_card_upserted',
  'deck_card_deleted',
  'focus_session_completed',
  'quest_claimed',
  'freeze_equipped',
  'rescue_completed',
  'cards_queued',
  'comeback_plan_started',
  'activity_completed',
  'palace_saved',
  'palace_deleted',
] as const satisfies readonly SyncEventType[];

/**
 * Events added in contract v1.4 (pending). A server on v1.3 rejects them as unknown, so send them
 * only once `/v1/config` or the contract says v1.4 is live.
 */
export const CONTRACT_V14_EVENT_TYPES = ['activity_completed'] as const satisfies readonly SyncEventType[];

/**
 * Events added in contract v1.5 (memory palaces). A v1.4 server rejects them as `unknown_type`, so
 * send them only to a v1.5 server.
 */
export const CONTRACT_V15_EVENT_TYPES = ['palace_saved', 'palace_deleted'] as const satisfies readonly SyncEventType[];

export interface WireEvent<T extends SyncEventType = SyncEventType> {
  event_id: string;
  type: T;
  occurred_at: string;
  tz: string;
  payload: SyncEventPayloads[T];
}

export interface SyncEventsRequest {
  device_id: string;
  events: WireEvent[];
}

export interface RejectedEvent {
  event_id: string;
  code: string;
  detail?: string;
}

export interface SyncEventsResponse {
  accepted: string[];
  rejected: RejectedEvent[];
  state_version: number;
}

export interface ProfileSection {
  id: string;
  display_name: string | null;
  locale: Locale;
  is_guest: boolean;
  age_band: AgeBand | null;
  exam_profile_ids: string[];
  daily_goal_minutes: number;
  timezone?: string;
}

export interface StreakSection {
  current: number;
  longest: number;
  today_qualified: boolean;
  freezes_equipped: number;
  freezes_available: number;
  rest_day: string | null;
  at_risk: boolean;
  /** (v1.4) ENT-08 freeze variant: missed days since the last studied day a freeze covered. */
  freeze_used_days?: string[];
  /** (v1.4) ENT-08 incident variant: missed days our outage covered (R28). */
  incident_days_covered?: string[];
  /** (v1.4) "Next free freeze on {date}": first day of next month, local; null without a grant. */
  next_free_freeze_on?: string | null;
}

export interface PlantSection {
  stage: 'seed' | 'sprout' | 'sapling' | 'flowering' | 'tree';
  health: 'thriving' | 'droopy' | 'dry' | 'wilted' | 'dormant';
  study_days: number;
  next_stage_at: number | null;
  revival_progress?: number;
  revival_days?: number | null;
}

export interface PetSection {
  species: 'cat' | 'dog';
  name: string;
  mood: number;
  energy: number;
  state: string;
}

export interface WalletSection {
  xp_total: number;
  xp_today: number;
  gems: number;
}

export interface SrsCardState {
  card_ref: string;
  due: string;
  stability: number;
  difficulty: number;
  state: 0 | 1 | 2 | 3;
  reps: number;
  lapses: number;
  last_review: string | null;
  suspended?: boolean;
  deck_id?: string | null;
  scheduled_days?: number;
  elapsed_days?: number;
  learning_steps?: number;
}

export interface TopicProgress {
  topic_id: string;
  status: 'not_started' | 'in_progress' | 'learned';
  percent: number;
  learned_via?: 'lesson' | 'test_out' | 'placement' | 'chapter_test' | null;
}

/**
 * Where Pro comes from (the API's `EntitlementOut.source`): a store or web subscription, a promo
 * grant, or a seat on someone else's family plan (`family`, managed only by the payer).
 */
export type EntitlementSource = 'razorpay' | 'play' | 'app_store' | 'promo' | 'family';

export interface EntitlementSection {
  plan: 'free' | 'pro';
  pro_until: string | null;
  status?: 'active' | 'trialing' | 'grace' | 'on_hold' | 'cancelled' | 'expired' | 'pending';
  grace_until?: string | null;
  cancel_at_period_end?: boolean;
  is_intro?: boolean;
  source?: EntitlementSource | null;
  /** (sync v1.4) Who manages the plan; absent from older servers (see `planManagedIn`). */
  managed_in?: PlanManagedIn;
}

/**
 * Where Manage plan goes (sync v1.4 `entitlement.managed_in`): this app's web checkout, a store,
 * the parent who pays (PAY-17), the family plan's payer, or nothing to manage.
 */
export type PlanManagedIn = 'web' | 'play' | 'app_store' | 'parent' | 'family' | 'none';

export interface SyncStateResponse {
  state_version: number;
  profile?: ProfileSection;
  streak?: StreakSection;
  plant?: PlantSection;
  pet?: PetSection | null;
  wallet?: WalletSection;
  srs?: { cards: SrsCardState[]; deleted: string[] };
  topic_progress?: TopicProgress[];
  entitlement?: EntitlementSection;
}

/** The canonical wire form of a card ref: `u:` becomes `d:` (sync contract v1.1). */
export function canonicalCardRef(ref: string): string {
  return ref.startsWith('u:') ? `d:${ref.slice(2)}` : ref;
}
