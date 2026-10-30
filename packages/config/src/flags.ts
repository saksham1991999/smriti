import { z } from 'zod/mini';

/**
 * The feature-flag and tunable registry, served by `GET /v1/config` (`ops.flags`).
 *
 * Every key named in `docs/flows/*.md` is listed here with the default the docs or the
 * orchestrator rulings give. `source` says where the default comes from:
 *
 * - `ruling`: DECISIONS.md (R-numbers)
 * - `prd`: PRD starting values ("the exact free limits are flags")
 * - `doc`: a value stated in a flow doc
 * - `proposed`: a starting value proposed in a flow doc (or here) for the owner to confirm
 * - `owner`: no number exists in any doc. The default is `null` and the app treats the
 *   feature or limit as "not set" (practice flow §4.1: never ship a guessed default).
 */
export type FlagSource = 'ruling' | 'prd' | 'doc' | 'proposed' | 'owner';

export interface FlagDef<S extends z.ZodMiniType = z.ZodMiniType, N extends boolean = boolean> {
  readonly schema: S;
  readonly default: N extends true ? null : z.infer<S>;
  /** True for owner flags: the value may be `null` (not set). */
  readonly nullable: N;
  readonly source: FlagSource;
  /** Where the key is named, e.g. `flows/auth.md §10.1`, `R29`. */
  readonly ref: string;
  /** Older spellings used in some docs. They are accepted from `/v1/config` and mapped here. */
  readonly aliases?: readonly string[];
}

function def<S extends z.ZodMiniType>(
  schema: S,
  dflt: z.infer<S>,
  source: Exclude<FlagSource, 'owner'>,
  ref: string,
  aliases?: readonly string[],
): FlagDef<S, false> {
  const base = { schema, default: dflt as FlagDef<S, false>['default'], nullable: false as const, source, ref };
  return aliases ? { ...base, aliases } : base;
}

/** An owner flag: no doc gives a number, so the default is `null` (not set). */
function owner<S extends z.ZodMiniType>(schema: S, ref: string, aliases?: readonly string[]): FlagDef<S, true> {
  const base = { schema, default: null, nullable: true as const, source: 'owner' as const, ref };
  return aliases ? { ...base, aliases } : base;
}

const int = z.int();
const nonNegInt = int.check(z.gte(0));
const posInt = int.check(z.gte(1));
const fraction = z.number().check(z.gte(0), z.lte(1));
const bool = z.boolean();
const hour = int.check(z.gte(0), z.lte(23));
const hhmm = z.string().check(z.regex(/^([01]\d|2[0-3]):[0-5]\d$/));
const strList = z.array(z.string());
const intList = z.array(int);
/** A value that differs by audience: adults, 13–17, under 13 (me-money §6.2). */
const byAudience = <S extends z.ZodMiniType>(s: S) => z.object({ adult: s, teen: s, child: s });
const byPlatform = <S extends z.ZodMiniType>(s: S) => z.object({ web: s, ios: s, android: s });
const i18nText = z.object({ en: z.string().check(z.minLength(1)), hi: z.string().check(z.minLength(1)) });
/** A two-part generated name ("{first} {second} {n}"): EN and HI words with stable ids. */
const word = z.object({ id: z.string().check(z.regex(/^[a-z0-9_]+$/)), en: z.string().check(z.minLength(1)), hi: z.string().check(z.minLength(1)) });
const wordPairs = z.object({ first: z.array(word), second: z.array(word) });
const helpline = z.catchall(z.object({ name: z.string().check(z.minLength(1)), number: z.string().check(z.minLength(1)) }), z.string());

export const FLAG_REGISTRY = {
  // ── Auth and accounts (flows/auth.md §10.1) ───────────────────────────────
  'auth.soft_prompt_cooldown_days': def(posInt, 7, 'ruling', 'R29, auth §4'),
  'auth.soft_prompt_later_limit': def(posInt, 2, 'ruling', 'R29, auth §4'),
  'auth.soft_prompt_pause_days': def(posInt, 14, 'ruling', 'R29, auth §4'),
  'auth.streak_prompt_hour': owner(hour, 'auth §4, learn §5.4'),
  'auth.streak_prompt_push': def(bool, false, 'doc', 'auth §4'),
  'auth.guardian_consent_gate': def(z.enum(['features', 'signin']), 'features', 'doc', 'auth §6.10, TRD §6'),
  'auth.guardian_digilocker': def(bool, false, 'doc', 'auth §6.10'),
  'auth.consent_pending_days': def(posInt, 7, 'proposed', 'auth §10.1'),
  'auth.consent_claim_days': def(posInt, 7, 'proposed', 'auth §10.1'),
  'auth.consent_handoff_ttl_min': def(posInt, 15, 'proposed', 'auth §10.1'),
  'auth.consent_link_ttl_h': def(posInt, 72, 'proposed', 'auth §10.1'),
  'auth.consent_retry_h': def(posInt, 24, 'proposed', 'auth §10.1'),
  'auth.consent_decline_limit': def(posInt, 3, 'proposed', 'auth §10.1'),
  'auth.consent_decline_pause_days': def(posInt, 30, 'proposed', 'auth §10.1'),
  'auth.consent_emails_per_day': def(posInt, 3, 'proposed', 'auth §6.10 (per guardian address)'),
  'auth.deletion_grace_days': def(posInt, 7, 'proposed', 'auth §6.8, PRD §16.4'),
  'auth.merge_wait_s': def(posInt, 30, 'proposed', 'auth §6.4'),
  'auth.merge_retries': def(nonNegInt, 3, 'proposed', 'auth §6.4'),
  'auth.returning_check_timeout_ms': def(posInt, 1500, 'proposed', 'auth §6.12'),
  'auth.chip_saving_max_s': def(posInt, 10, 'proposed', 'auth §6.13'),
  'auth.signin_timeout_s': def(posInt, 15, 'proposed', 'auth §7'),
  'auth.nonce_error_alert_rate': def(fraction, 0.005, 'proposed', 'auth §7'),
  'auth.max_children_per_guardian': owner(posInt, 'auth §10.1, AUTH-26'),
  'merge.keep_guest_pet': def(bool, true, 'doc', 'auth §6.4 step 7'),
  'minor.defer_sync_until_consent': def(bool, false, 'doc', 'onboarding §6.2.1'),
  'parent.ask_before_switching': def(bool, false, 'doc', 'auth §6.11'),
  'parent.time_limit_options': def(z.array(nonNegInt).check(z.minLength(1)), [0, 15, 30, 45, 60, 90, 120], 'doc', 'me-money §4.7 SET-16 (0 = Off)'),
  'parent.time_request_minutes': def(posInt, 15, 'doc', 'me-money §4.7 SET-19'),
  'parent.time_requests_per_day': def(posInt, 3, 'doc', 'me-money §6 parent_time_request'),
  'parent.gate_hold_ms': def(posInt, 2000, 'doc', 'learn HOME-06 accessibility (hold 2 s)'),
  'onb.returning_account_check': def(bool, false, 'doc', 'onboarding §6.9.1 (A/B test)'),
  'onb.outcome_line': def(bool, false, 'doc', 'onboarding §6.8 (test)'),
  'goal.minutes_options': def(z.array(posInt).check(z.minLength(1)), [5, 10, 20, 30], 'ruling', 'R6'),
  'goal.default_minutes': def(posInt, 10, 'ruling', 'R6'),

  // ── Streak, freezes and rest days (me-money §3.5, R1, R23, R28, R36) ─────
  'streak.reviews_to_qualify': def(posInt, 10, 'ruling', 'R1, memory-labs §5.1'),
  'streak.freeze_slots_max': def(nonNegInt, 2, 'ruling', 'R28, R36, learn §5.4', ['streak.freeze_slots']),
  'streak.monthly_freezes': def(z.object({ free: nonNegInt, pro: nonNegInt }), { free: 1, pro: 2 }, 'prd', 'PRD §7, §11.1, R36'),
  'streak.incident_freeze': def(bool, false, 'ruling', 'R28, me-money §3.5'),
  'streak.rest_day_plan_ahead_days': def(posInt, 30, 'proposed', 'me-money §3.5'),
  'streak.exam_day_protected': def(bool, true, 'proposed', 'me-money §3.5'),
  'game.rest_days_per_week': def(nonNegInt, 1, 'ruling', 'R36, me-money Q10'),

  // ── Plant (R2, R12, R37, me-money §3.4, APP_FLOW §3.6) ───────────────────
  'game.plant.stage_days': def(
    z.tuple([posInt, posInt, posInt, posInt]),
    [1, 7, 30, 100],
    'ruling',
    'R37, me-money §3.4',
    ['plant.thresholds'],
  ),
  'game.plant.health_missed_days': def(
    z.object({ droopy: posInt, dry: posInt, wilted: posInt, dormant: posInt }),
    { droopy: 1, dry: 3, wilted: 7, dormant: 21 },
    'doc',
    'APP_FLOW §3.6, me-money §3.4',
  ),
  'game.plant.revival_days': def(
    z.object({ droopy: posInt, dry: posInt, wilted: posInt, dormant: posInt }),
    { droopy: 1, dry: 2, wilted: 3, dormant: 5 },
    'ruling',
    'R12',
  ),

  // ── Pet (me-money §3.3; decay amounts are not in any doc: proposed here) ─
  'game.pet.start': def(z.object({ mood: nonNegInt, energy: nonNegInt }), { mood: 80, energy: 80 }, 'doc', 'DB_SCHEMA game.pets defaults'),
  'game.pet.decay_per_missed_day': def(z.object({ mood: nonNegInt, energy: nonNegInt }), { mood: 10, energy: 10 }, 'proposed', 'TRD §10'),
  'game.pet.study_gain': def(z.object({ mood: nonNegInt, energy: nonNegInt }), { mood: 20, energy: 15 }, 'proposed', 'TRD §10, PRD §7'),
  'game.pet.state_min_mood': def(
    z.object({ happy: nonNegInt, content: nonNegInt, sleepy: nonNegInt, tired: nonNegInt }),
    { happy: 70, content: 50, sleepy: 30, tired: 15 },
    'proposed',
    'me-money §3.3',
  ),
  'game.pet.missing_you_energy_below': def(nonNegInt, 30, 'proposed', 'me-money §3.3'),
  'game.pet.care_mood_cap_per_day': def(nonNegInt, 5, 'doc', 'me-money §3.3'),
  'game.pet.pet_mood_gain': def(nonNegInt, 2, 'proposed', 'me-money §3.3'),
  'game.pet.plays_per_day': def(nonNegInt, 3, 'doc', 'me-money §3.3'),
  'game.pet.play_energy_gain': def(nonNegInt, 3, 'proposed', 'me-money §3.3'),
  'game.pet.treats_per_day': def(nonNegInt, 1, 'doc', 'me-money §3.3'),
  'game.pet.treat_energy_gain': def(nonNegInt, 8, 'proposed', 'me-money §3.3'),
  'game.pet.species_switch_days': def(posInt, 30, 'doc', 'me-money §3.3, Q15'),

  // ── Gems, shop and economy (R36, me-money §3.6) ─────────────────────────
  'game.economy.daily_quest_gems': def(z.object({ min: nonNegInt, max: nonNegInt }), { min: 5, max: 15 }, 'proposed', 'me-money §3.6'),
  'game.economy.weekly_quest_gems': def(nonNegInt, 50, 'proposed', 'me-money §3.6'),
  'game.economy.badge_gems': def(z.tuple([nonNegInt, nonNegInt, nonNegInt]), [20, 50, 100], 'proposed', 'me-money §3.6'),
  'game.economy.league_promotion_gems': def(nonNegInt, 50, 'proposed', 'me-money §3.6'),
  'game.economy.streak_milestone_gems': def(z.record(z.string().check(z.regex(/^\d+$/)), nonNegInt), { '7': 25, '30': 50, '100': 100, '365': 200 }, 'proposed', 'me-money §3.6'),
  'game.economy.first_revival_gems': def(nonNegInt, 50, 'proposed', 'me-money §3.6'),
  'game.economy.referral_gems': def(nonNegInt, 50, 'proposed', 'me-money §3.6'),
  'game.shop.treats_max_held': def(posInt, 10, 'proposed', 'me-money §3.6'),
  'share.streak_milestones': def(intList, [7, 30, 100], 'ruling', 'R37, me-money §3.4'),
  'comeback.long_gap_days': def(posInt, 30, 'ruling', 'R34, me-money §6.2'),

  // ── Leagues and social (R30, R32, tutor-social) ──────────────────────────
  'league.tier_names': def(
    z.array(i18nText).check(z.length(10)),
    [
      { en: 'Seed', hi: 'बीज' },
      { en: 'Sprout', hi: 'अंकुर' },
      { en: 'Leaf', hi: 'पत्ती' },
      { en: 'Bud', hi: 'कली' },
      { en: 'Bloom', hi: 'फूल' },
      { en: 'Lotus', hi: 'कमल' },
      { en: 'Mango', hi: 'आम' },
      { en: 'Neem', hi: 'नीम' },
      { en: 'Peepal', hi: 'पीपल' },
      { en: 'Banyan', hi: 'बरगद' },
    ],
    'ruling',
    'R30, PRD §7',
    ['leagues.tiers'],
  ),
  'league.group_size': def(posInt, 30, 'ruling', 'R30, PRD §7', ['leagues.group_size', 'league_cohort_size']),
  'league.promote_count': def(nonNegInt, 7, 'ruling', 'R30, tutor-social B6, Q-B2', ['league_promote_count']),
  'league.demote_count': def(nonNegInt, 5, 'ruling', 'R30, tutor-social B6, Q-B2', ['league_demote_count']),
  'league.close_time': def(hhmm, '23:59', 'doc', 'TRD §10 (Sunday, IST), tutor-social B6', ['league_close_time']),
  'social.duo_max_partners': def(posInt, 5, 'ruling', 'R32, tutor-social B8', ['duo_max_partners']),
  'social.deck_listing': def(bool, false, 'doc', 'tutor-social B12'),
  'social.friend_request_ttl_days': owner(posInt, 'tutor-social B5', ['friend_request_ttl_days']),
  'social.friend_requests_per_day': owner(posInt, 'tutor-social B5', ['friend_requests_per_day']),
  'social.max_friends': owner(posInt, 'tutor-social B5', ['max_friends']),
  'social.handle_change_days': owner(posInt, 'tutor-social B14', ['handle_change_days']),
  'social.handle_reserve_days': def(posInt, 30, 'doc', 'tutor-social B14 ("reserved for 30 days")'),
  'social.duo_invite_ttl_days': owner(posInt, 'tutor-social B8', ['duo_invite_ttl_days']),
  'social.duo_nudges_per_day': owner(posInt, 'tutor-social B8', ['duo_nudges_per_day']),
  'social.cheers_per_friend_per_day': owner(posInt, 'tutor-social B11', ['cheers_per_friend_per_day']),
  'social.nudges_per_friend_per_day': owner(posInt, 'tutor-social B11', ['nudges_per_friend_per_day']),
  'social.squad_max_members': def(posInt, 20, 'doc', 'tutor-social B9 (DB default)', ['squad_max_members']),
  'social.squads_per_user': def(posInt, 3, 'proposed', 'tutor-social B9 (recommended)', ['squads_per_user']),
  // The EN and HI word list for minors' public nicknames (R31 amended). It needs a named owner and a
  // safety review of every pair before use (Q-B11), so nothing ships here: until it is set, minors
  // appear as `social.nickname_fallback` plus their number ("Learner 27").
  'social.nickname_words': owner(wordPairs, 'R31 amended, tutor-social B1, Q-B11 (safety review pending)'),
  'social.nickname_fallback': def(i18nText, { en: 'Learner', hi: 'शिक्षार्थी' }, 'proposed', 'R31 amended (until Q-B11 is closed)'),
  'social.squad_name_words': owner(wordPairs, 'tutor-social B9, G-S6 (name picker list in config)'),
  'social.squad_name_fallback': def(i18nText, { en: 'Squad', hi: 'स्क्वॉड' }, 'proposed', 'tutor-social B9 (until the name list is set)'),

  // ── Duels (tutor-social B10; anti-abuse values are owner flags, Q-B10) ────
  'duel.question_count': def(posInt, 10, 'prd', 'PRD §8, tutor-social B10', ['duel_question_count']),
  // Proposed so duels run (R53); each one is marked for the owner to confirm.
  'duel.question_seconds': def(posInt, 20, 'proposed', 'R53, tutor-social B10 (owner to confirm)', ['duel_question_seconds']),
  'duel.question_seconds_u13': def(posInt, 30, 'proposed', 'R53, tutor-social B10 §9 (owner to confirm)', ['duel_question_seconds_u13']),
  'duel.invite_live_seconds': def(posInt, 60, 'proposed', 'tutor-social B10 (recommended 60)', ['duel_invite_live_seconds']),
  'duel.async_ttl_hours': def(posInt, 24, 'proposed', 'tutor-social B10 (recommended 24)', ['duel_async_ttl_hours']),
  'duel.match_timeout_seconds': def(posInt, 10, 'ruling', 'R31, tutor-social B10', ['duel_match_timeout_seconds']),
  'duel.disconnect_grace_seconds': def(posInt, 15, 'proposed', 'tutor-social B10 (recommended 15)', ['duel_disconnect_grace_seconds']),
  'duel.rematch_wait_seconds': def(posInt, 60, 'proposed', 'R53, tutor-social B10 (owner to confirm)', ['duel_rematch_wait_seconds']),
  'duel.min_answer_ms': def(posInt, 800, 'proposed', 'R53, tutor-social B10, Q-B10 (owner to confirm)', ['duel_min_answer_ms']),
  'duel.quit_limit': def(posInt, 3, 'proposed', 'R53, tutor-social B10, Q-B10: 3 a day (owner to confirm)', ['duel_quit_limit']),
  'duel.quit_window_hours': def(posInt, 24, 'proposed', 'R53, tutor-social B10, Q-B10: "a day" (owner to confirm)', ['duel_quit_window_hours']),
  // Null by design: the pause lasts until the oldest quit leaves the window.
  'duel.quit_cooldown_minutes': owner(posInt, 'tutor-social B10, Q-B10 (null: until the quit window clears)', ['duel_quit_cooldown_minutes']),
  'duel.speed_bonus_max': def(nonNegInt, 5, 'proposed', 'R53, tutor-social B10 ("a speed bonus from config"; owner to confirm)'),
  // Null by design: duel XP is play plus win, not per correct answer, unless the owner turns it on.
  'xp.duel_per_correct': owner(nonNegInt, 'tutor-social B10, R51 (null: off)'),
  'xp.duel_play': def(nonNegInt, 5, 'proposed', 'R53, tutor-social B10, R51 (owner to confirm)'),
  'xp.duel_win': def(nonNegInt, 20, 'proposed', 'R53, tutor-social B10, R51 (owner to confirm)'),

  // ── Free vs Pro limits (PRD §11.1, R16, R25, R35) ────────────────────────
  'free.practice_questions_per_day': def(nonNegInt, 30, 'prd', 'PRD §11.1, R25, practice §4.1'),
  'free.sectional_mocks_per_week': def(nonNegInt, 1, 'prd', 'PRD §11.1, R25'),
  'free.deep_dive_preview_cards': def(nonNegInt, 4, 'ruling', 'R16'),
  'free.deep_dive_free_chapters_per_subject': def(nonNegInt, 2, 'prd', 'PRD §11.1, learn §6.2'),
  'free.rotating_chapters': def(strList, [], 'doc', 'learn G6 (served in the manifest)'),
  'free.tutor_messages_per_day': def(nonNegInt, 5, 'prd', 'PRD §11.1, R35', ['free_tutor_messages_per_day']),
  'pro.tutor_messages_per_day': owner(posInt, 'tutor-social A6', ['pro_tutor_messages_per_day']),
  'free.tutor_read_aloud_per_day': owner(nonNegInt, 'R35, tutor-social A6'),
  'free.roleplay_chats_per_day': owner(nonNegInt, 'tutor-social A11'),
  'roleplay.max_turns': owner(posInt, 'tutor-social A11', ['roleplay_max_turns']),
  'free.forge_trials_lifetime': def(nonNegInt, 1, 'proposed', 'memory-labs §11, Q2'),
  'free.pyq_mode': def(z.enum(['counted']), 'counted', 'ruling', 'R25, practice §4.1'),
  'free.pyq_papers_free': def(strList, [], 'ruling', 'R25 (one paper id per exam, server data)'),
  'free.mock_report_sections': def(
    strList,
    ['score', 'accuracy', 'time_lost_wrong', 'section_bars', 'subject_bars', 'attempt_summary', 'solutions', 'fix_next_top'],
    'ruling',
    'R25, R43, practice §4.1',
  ),
  'pro.custom_mocks': def(bool, true, 'doc', 'practice §4.1 (MOCK-26)'),
  'billing.trial_reminder_days_before': def(posInt, 3, 'ruling', 'R33'),
  'billing.offline_grace_days': def(nonNegInt, 3, 'doc', 'me-money §5.1'),
  'billing.web_grace_days': def(posInt, 7, 'proposed', 'me-money §5.1 (Razorpay pending to grace)'),
  // Family plan for siblings (PRD §11.2, Phase 3). Neither the price nor the seat count is in the
  // docs: the plan stays hidden from /v1/config and checkout until the owner sets the seats and
  // the price for that period.
  'billing.family_seats': owner(posInt, 'PRD §11.2 family plan (null: hidden; people besides the payer)'),
  'billing.family_monthly_price_paise': owner(posInt, 'PRD §11.2 family plan (null: monthly family plan hidden)'),
  'billing.family_yearly_price_paise': owner(posInt, 'PRD §11.2 family plan (null: yearly family plan hidden)'),
  'export.books_per_day': def(posInt, 5, 'proposed', 'me-money §3.9'),
  'export.expiry_days': def(posInt, 30, 'proposed', 'me-money §3.9'),
  'pay.child_link.enabled': def(byPlatform(bool), { web: true, ios: false, android: false }, 'doc', 'me-money Q7'),
  'pay.web_steering': def(bool, false, 'doc', 'me-money §5.6'),

  // ── Features by phase (me-money §5.3, R8) ────────────────────────────────
  'feature.live_mocks': def(bool, false, 'doc', 'Phase 3'),
  'feature.little_learner': def(bool, false, 'doc', 'Phase 3 (onboarding §6.3, learn §5.6)'),
  'feature.voice_tutor': def(bool, false, 'doc', 'Phase 2'),
  'feature.feynman': def(bool, false, 'doc', 'Phase 2'),
  'feature.photo_doubt': def(bool, false, 'doc', 'Phase 1 or 2'),
  'feature.pdf_export': def(bool, false, 'doc', 'Phase 2'),
  'feature.ai_notes': def(bool, false, 'doc', 'Phase 2'),
  'feature.pro_cosmetics': def(bool, true, 'doc', 'Phase 1'),
  'live.enabled': def(bool, false, 'doc', 'practice §4.1 (per variant)'),
  'practice.mixed_enabled': def(bool, false, 'doc', 'practice §5.3 (Phase 2)'),
  'maintenance.active': def(bool, false, 'doc', 'onboarding §6.14'),
  'perf.rive_enabled': def(bool, true, 'doc', 'onboarding §7 (per device class)'),

  // ── Mocks and analytics thresholds (owner: practice §9.2) ────────────────
  'mock.min_attempts_for_percentile': owner(posInt, 'R26, practice §6.10'),
  'mock.free_grace_min': owner(posInt, 'practice §4.1, Q3'),
  'mock.offline_grace_s': owner(nonNegInt, 'practice §6.6 (not set: no grace past the deadline)'),
  'report.fix_next_count': owner(posInt, 'practice §6.10 (not set: every next step)'),
  'practice.weak_min_attempts': owner(posInt, 'practice §5.2'),
  'practice.weak_accuracy_below': owner(fraction, 'practice §5.2'),
  'practice.weak_sure_wrong_min': owner(posInt, 'practice §5.2'),
  'practice.weak_recent_mocks': owner(posInt, 'practice §5.2'),
  'daily.min_players_for_rank': owner(posInt, 'practice §5.5 (PRC-12)'),

  // ── AI tutor (tutor-social Part A) ───────────────────────────────────────
  'ai.tutor_retention_days': def(posInt, 180, 'doc', 'tutor-social §A7, §A14 (180-day retention)'),
  'ai.tutor_session_reuse_min': def(posInt, 30, 'doc', 'tutor-social §A5 step 1 (last 30 minutes)'),
  'ai.llm_moderation': def(bool, false, 'proposed', 'tutor-social §A7 (cheap-tier check after the word lists)'),
  'tutor.max_input_chars': owner(posInt, 'tutor-social §A13 (the API schema caps at 4000)'),
  // Verified against official sources by the owner and legal before launch (tutor-social §A7, AGENTS rule 3).
  'safety.helplines': owner(z.partial(z.object({ en: z.array(helpline), hi: z.array(helpline) })), 'tutor-social §A7'),
  'analytics.min_answers_per_chapter': owner(posInt, 'practice §5.6'),
  'analytics.min_answers_per_subject': owner(posInt, 'practice §5.6'),
  'analytics.min_answers_total': owner(posInt, 'practice §5.6'),
  'analytics.min_concepts_for_readiness': owner(posInt, 'practice §5.6'),
  'analytics.min_mocks_for_trend': owner(posInt, 'practice §5.6'),
  'analytics.min_tagged_answers': owner(posInt, 'practice §5.6'),

  // ── Home, learn and plan (learn §5, §6, §7) ──────────────────────────────
  'home.review_hero_min_cards': owner(posInt, 'learn §5.2'),
  'home.streak_risk_hour': owner(hour, 'learn §5.2 (null: 1 h before quiet hours)'),
  'home.continue_max_age_days': owner(posInt, 'learn §5.2'),
  'home.strip_max_nodes': owner(posInt, 'learn §5.2'),
  'home.strip_max_review_nodes': owner(posInt, 'learn §5.3'),
  // ── XP amounts (flows/learn.md §7.5 item 10). Proposed until the owner sets them (R51). ──
  'xp.lesson_first_try': def(nonNegInt, 10, 'proposed', 'learn §7, R51'),
  'xp.lesson_second_try': def(nonNegInt, 5, 'proposed', 'learn §7, R51'),
  'xp.lesson_attempt': def(nonNegInt, 1, 'proposed', 'learn §7, R51'),
  'xp.lesson_complete': def(nonNegInt, 20, 'proposed', 'learn §7, R51'),
  'xp.combo_bonus': def(nonNegInt, 10, 'proposed', 'learn §7.3 A19, R51'),
  'learn.find_level_questions': def(posInt, 5, 'ruling', 'R27, learn §6.5'),
  'learn.combo_streak_len': def(posInt, 5, 'doc', 'learn §7.3 (A19)'),
  'learn.exit_nudge_cards_left': owner(nonNegInt, 'ux/learn LES-05'),
  'learn.first_time_demo_max_s': owner(posInt, 'learn §7.3'),
  'learn.fix_mistakes_max': owner(posInt, 'learn §7.1'),
  'learn.prereq_mastery_min': owner(fraction, 'learn §6.3'),
  'learn.prereq_snooze_days': owner(posInt, 'learn §6.3'),
  'learn.resume_restart_days': owner(posInt, 'learn §7.7'),
  'learn.test_out_questions_per_topic': owner(posInt, 'learn §6.4'),
  'learn.video_complete_pct': owner(fraction, 'learn §8'),
  'learn.weak_filter_min_attempts': owner(posInt, 'ux/learn'),
  'plan.time_options': def(z.array(posInt).check(z.minLength(1)), [5, 10, 20, 30], 'proposed', 'learn §8 (defaults to R6 goal options)'),
  'plan.swap_alternatives_max': owner(posInt, 'learn §8'),
  'search.recent_max': owner(posInt, 'learn §8'),

  // ── Memory and labs (memory-labs §11) ────────────────────────────────────
  'memory.rescue_cards': def(posInt, 5, 'proposed', 'memory-labs §5.13, Q14'),
  'memory.comeback.first_session': def(posInt, 10, 'doc', 'memory-labs §5.2'),
  'memory.queue_from_practice_max': def(posInt, 20, 'proposed', 'memory-labs §5.14'),
  'memory.session_size': def(posInt, 20, 'doc', 'memory-labs §5.1'),
  'memory.session_size_options': def(z.array(z.union([posInt, z.literal('all')])), [10, 20, 40, 'all'], 'doc', 'memory-labs §5.1'),
  'memory.daily_review_cap': def(posInt, 200, 'proposed', 'memory-labs §5.1'),
  'memory.new_cards_per_day': def(nonNegInt, 15, 'proposed', 'memory-labs §5.1'),
  'memory.leech_lapses': def(posInt, 8, 'proposed', 'memory-labs §5.3'),
  'memory.comeback.min_due': def(posInt, 60, 'proposed', 'memory-labs §5.2'),
  'memory.comeback.relearn_below': def(fraction, 0.5, 'ruling', 'memory-labs §5.2; 0.5 per the coordinator ruling of 30 Oct 2026'),
  'memory.comeback.plan_lengths': def(z.array(posInt).check(z.minLength(1)), [3, 5, 7], 'ruling', 'R22'),
  'memory.default_seconds_per_card': def(posInt, 10, 'proposed', 'memory-labs §5.2'),
  'memory.retention_presets': def(
    z.object({ relaxed: fraction, standard: fraction, exam: fraction }),
    { relaxed: 0.85, standard: 0.9, exam: 0.95 },
    'proposed',
    'memory-labs §11 (MEM-06)',
  ),
  'memory.fsrs.enable_fuzz': def(bool, true, 'doc', 'memory-labs §5.1 ("with fuzz applied")'),
  'memory.fsrs.maximum_interval_days': def(posInt, 36500, 'proposed', 'ts-fsrs default'),
  'metacog.min_tagged': def(posInt, 30, 'proposed', 'memory-labs §5.10'),
  'metacog.min_tagged_per_topic': def(posInt, 5, 'proposed', 'memory-labs §5.10'),
  'metacog.targets': def(
    z.object({ sure: fraction, fifty: fraction, guess: fraction }),
    { sure: 0.9, fifty: 0.5, guess: 0.25 },
    'proposed',
    'memory-labs §11, Q5',
    ['metacog.target_sure'],
  ),
  'community.hide_after_reports': def(posInt, 3, 'proposed', 'memory-labs §5.7'),
  'focus.presets': def(
    z.array(z.object({ focus: posInt, break: posInt })),
    [
      { focus: 15, break: 3 },
      { focus: 25, break: 5 },
      { focus: 50, break: 10 },
    ],
    'doc',
    'memory-labs §5.12, PRD §5.4',
  ),
  'focus.rounds_before_long_break': def(posInt, 4, 'proposed', 'memory-labs §5.12'),
  'focus.long_break_min': def(posInt, 15, 'proposed', 'memory-labs §5.12'),
  'focus.away_note_after_min': def(posInt, 3, 'proposed', 'memory-labs §5.12'),
  'focus.cram_nudge_rounds': def(posInt, 4, 'proposed', 'memory-labs §5.12'),
  'lab.confirm_download_mb': def(posInt, 5, 'proposed', 'memory-labs §6.1'),
  'lab.low_power_battery_pct': def(int.check(z.gte(0), z.lte(100)), 20, 'proposed', 'memory-labs §6.2'),
  'sim.ready_timeout_ms': def(posInt, 8000, 'proposed', 'memory-labs §6.2'),
  'sim.ready_timeout_ms_low': def(posInt, 12000, 'proposed', 'memory-labs §6.2'),
  'sim.max_state_hz': def(posInt, 10, 'proposed', 'memory-labs §6.2'),
  'sim.max_errors': def(posInt, 20, 'proposed', 'memory-labs §8'),
  'labs.featured': def(strList, [], 'doc', 'memory-labs §6.1 (published item ids)'),

  // ── Content downloads (TRD §3.2, me-money §3.8) ──────────────────────────
  'content.cache_limit_mb': def(posInt, 500, 'doc', 'TRD §3.2'),

  // ── Notifications (me-money §6.2; every number a flag) ───────────────────
  'notify.cap.habit': def(byAudience(nonNegInt), { adult: 2, teen: 1, child: 1 }, 'doc', 'me-money §6.2'),
  'notify.cap.learning': def(byAudience(nonNegInt), { adult: 1, teen: 0, child: 0 }, 'doc', 'me-money §6.2'),
  'notify.cap.social': def(byAudience(nonNegInt), { adult: 3, teen: 2, child: 0 }, 'doc', 'me-money §6.2'),
  'notify.cap.total': def(byAudience(nonNegInt), { adult: 4, teen: 3, child: 1 }, 'doc', 'me-money §6.2'),
  'notify.quiet_hours': def(
    byAudience(z.object({ start: hhmm, end: hhmm })),
    { adult: { start: '22:00', end: '07:00' }, teen: { start: '21:00', end: '07:00' }, child: { start: '20:00', end: '08:00' } },
    'doc',
    'me-money §6.2, TRD §12',
  ),
  'notify.school_hours': def(z.object({ start: hhmm, end: hhmm }), { start: '08:00', end: '14:00' }, 'doc', 'me-money §6.2'),
  'notify.smart.offset_hours': def(z.number().check(z.gte(0)), 23.5, 'doc', 'me-money §6.2'),
  'notify.autopause_after_ignored': def(posInt, 7, 'ruling', 'R34, TRD §12'),
  'notify.templates.min_per_kind': def(posInt, 3, 'doc', 'me-money §6.2'),
  'notify.templates.repeat_gap_days': owner(posInt, 'me-money §6.2'),
  'notify.bandit': def(bool, false, 'doc', 'me-money Q17'),
  'notify.review_due.min_cards': owner(posInt, 'me-money §6.3'),
  'notify.mock_reminder.lead_min': owner(posInt, 'me-money §6.3'),
  'notify.sleep_review.lead_min': def(posInt, 20, 'prd', 'PRD §5.4 ("about 20 minutes")'),
  'notify.plan_days': def(posInt, 7, 'doc', 'me-money §6.1'),
  'widget.evening_hour': owner(hour, 'me-money §6.6'),

  // ── Phase 2 AI: voice tutor, read-aloud, dictation, Feynman (tutor-social §A6, §A8, §A9; TRD §9.4) ──
  'pro.voice_daily_seconds': def(posInt, 900, 'proposed', 'tutor-social A9 step 5, PRD §5.5 (fair use per day); proposed (R54), owner to confirm', ['voice_daily_seconds']),
  'voice.session_max_seconds': def(posInt, 600, 'proposed', 'tutor-social A9 step 5; proposed (R54), owner to confirm', ['voice_session_max_seconds']),
  'voice.reconnect_seconds': def(posInt, 30, 'proposed', 'tutor-social A9 step 6; proposed (R54), owner to confirm', ['voice_reconnect_seconds']),
  'voice.background_grace_seconds': def(posInt, 20, 'proposed', 'tutor-social A9 step 7; proposed (R54), owner to confirm', ['voice_background_grace_seconds']),
  'pro.dictation_per_day': def(posInt, 30, 'proposed', 'TRD §9.4 (Deepgram STT), tutor-social A6; proposed (R54), owner to confirm'),
  'feynman.min_words': def(posInt, 30, 'proposed', 'tutor-social A8; proposed (R54), owner to confirm', ['feynman_min_words']),
  'feynman.max_record_seconds': def(posInt, 120, 'proposed', 'tutor-social A8; proposed (R54), owner to confirm', ['feynman_max_record_seconds']),
  'feynman.bands': def(z.object({ getting_there: int.check(z.gte(0), z.lte(100)), clear: int.check(z.gte(0), z.lte(100)) }), { getting_there: 40, clear: 70 }, 'proposed', 'tutor-social A8, ux AI-11 (lower bounds on the 0-100 score: needs work, getting there, clear); proposed (R54), owner to confirm', ['feynman_bands']),
  'feynman.max_follow_ups': def(posInt, 3, 'doc', 'tutor-social A8 ("1 to 3 short follow-up answers")'),
  'feynman.mastery_weight': def(fraction, 0.1, 'proposed', 'IMPLEMENTATION_PLAN G-3 (Feynman feeds mastery as a weak signal)'),

  // ── Learning-science jobs (TRD §9.6, IMPLEMENTATION_PLAN G-8) ────────────
  'notify.weak_area.horizon_days': def(posInt, 3, 'doc', 'TRD §9.6 ("for the next 3 days")'),
  'notify.weak_area.per_week': def(posInt, 2, 'doc', 'me-money §6.3 (weak_area: 2 a week)'),
  'notify.sleep_review.lookback_days': def(posInt, 14, 'doc', 'TRD §9.6 ("the last 14 days")'),
  'notify.sleep_review.cards': def(posInt, 5, 'doc', 'TRD §9.6 ("the 5 hardest due cards")'),
  'notify.sleep_review.min_confidence': def(fraction, 0.6, 'proposed', 'TRD §9.6 ("if confidence is high enough"); proposed (R54), owner to confirm'),
  'practice.mixed_min_groups': def(posInt, 2, 'doc', 'practice §5.3 ("two or more subjects or chapters")'),

  // ── Security and anti-cheat (TRD §10, §14; IMPLEMENTATION_PLAN G-10) ─────
  'security.attestation_required': def(bool, false, 'doc', 'TRD §14 (Phase 2; on once the apps send attestation)'),
  'anticheat.min_answer_ms': def(posInt, 700, 'proposed', 'TRD §10 (answer timing); proposed (R54), owner to confirm'),
  'anticheat.min_review_ms': def(posInt, 500, 'proposed', 'TRD §10 (time per card); proposed (R54), owner to confirm'),

  // ── Live mocks (practice §6.11, Phase 3) ─────────────────────────────────
  'live.room_lead_min': def(posInt, 15, 'proposed', 'practice §6.11 ("room opens at window_start minus room lead"); proposed (R54), owner to confirm'),

  // ── Data (IMPLEMENTATION_PLAN G-11) ──────────────────────────────────────
  'memory.fsrs.optimise_min_reviews': def(posInt, 400, 'proposed', 'G-11 per-user FSRS optimisation; proposed (R54), owner to confirm'),
  'irt.min_responses': def(posInt, 200, 'proposed', 'G-11 IRT calibration; proposed (R54), owner to confirm'),
} as const satisfies Record<string, FlagDef<z.ZodMiniType, boolean>>;

export type FlagKey = keyof typeof FLAG_REGISTRY;
export type FlagValue<K extends FlagKey> = z.infer<(typeof FLAG_REGISTRY)[K]['schema']>;
/** `null` only for owner flags (no default) that the server has not set. */
export type FlagResult<K extends FlagKey> = (typeof FLAG_REGISTRY)[K]['nullable'] extends true
  ? FlagValue<K> | null
  : FlagValue<K>;

export const FLAG_KEYS = Object.keys(FLAG_REGISTRY) as FlagKey[];

export interface FlagIssue {
  key: string;
  problem: 'invalid' | 'unknown';
  detail?: string;
}

export interface Flags {
  /** The typed value: the server's value when valid, else the registry default. */
  get<K extends FlagKey>(key: K): FlagResult<K>;
  /** Like `get`, but throws when the value is not set (owner flags with no default). */
  require<K extends FlagKey>(key: K): FlagValue<K>;
  /** True when the server sent a valid value for this key. */
  isFromServer(key: FlagKey): boolean;
  /** Problems found while reading the server map (invalid values, unknown keys). Never values. */
  readonly issues: readonly FlagIssue[];
  /** A plain object of every key and its resolved value. */
  toJSON(): { [K in FlagKey]: FlagResult<K> };
}

const ALIAS_TO_KEY: ReadonlyMap<string, FlagKey> = (() => {
  const m = new Map<string, FlagKey>();
  for (const key of FLAG_KEYS) {
    const defn: FlagDef = FLAG_REGISTRY[key];
    for (const alias of defn.aliases ?? []) m.set(alias, key);
  }
  return m;
})();

/**
 * Builds the typed flag map from the `flags` object of `GET /v1/config`.
 * Invalid or missing values fall back to the registry default and are reported in `issues`.
 */
export function createFlags(serverFlags: Record<string, unknown> | undefined = {}): Flags {
  const values = new Map<FlagKey, unknown>();
  const fromServer = new Set<FlagKey>();
  const issues: FlagIssue[] = [];

  for (const [rawKey, rawValue] of Object.entries(serverFlags ?? {})) {
    const key = (rawKey in FLAG_REGISTRY ? rawKey : ALIAS_TO_KEY.get(rawKey)) as FlagKey | undefined;
    if (!key) {
      issues.push({ key: rawKey, problem: 'unknown' });
      continue;
    }
    if (fromServer.has(key) && rawKey !== key) continue; // the canonical key wins over an alias
    const defn: FlagDef = FLAG_REGISTRY[key];
    if (rawValue === null && defn.nullable) {
      values.set(key, null);
      fromServer.add(key);
      continue;
    }
    const parsed = defn.schema.safeParse(rawValue);
    if (parsed.success) {
      values.set(key, parsed.data);
      fromServer.add(key);
    } else {
      issues.push({ key, problem: 'invalid', detail: parsed.error.issues[0]?.message ?? 'invalid' });
    }
  }

  const resolve = (key: FlagKey): unknown => (values.has(key) ? values.get(key) : FLAG_REGISTRY[key].default);

  return {
    get: <K extends FlagKey>(key: K) => resolve(key) as FlagResult<K>,
    require: <K extends FlagKey>(key: K) => {
      const v = resolve(key);
      if (v === null || v === undefined) throw new Error(`Flag ${key} is not set`);
      return v as FlagValue<K>;
    },
    isFromServer: (key) => fromServer.has(key),
    issues,
    toJSON: () => {
      const out: Record<string, unknown> = {};
      for (const key of FLAG_KEYS) out[key] = resolve(key);
      return out as { [K in FlagKey]: FlagResult<K> };
    },
  };
}

/** Where the server's copy of the defaults lives, relative to this package. */
export const FLAG_DEFAULTS_FILE = 'flag-defaults.json';

/**
 * The registry's defaults as plain JSON, for the API (`apps/api` reads `flag-defaults.json`, so
 * the server and the apps share one set of defaults). Regenerate with `pnpm --filter
 * @smriti/config flags:export`; a test fails when the file is stale.
 */
export function flagDefaultsDocument(): {
  note: string;
  flags: Record<string, { default: unknown; source: FlagSource }>;
  aliases: Record<string, string>;
} {
  const flags: Record<string, { default: unknown; source: FlagSource }> = {};
  const aliases: Record<string, string> = {};
  for (const key of [...FLAG_KEYS].sort()) {
    const defn: FlagDef = FLAG_REGISTRY[key];
    flags[key] = { default: defn.default, source: defn.source };
    for (const alias of defn.aliases ?? []) aliases[alias] = key;
  }
  return {
    note: 'Generated from packages/config/src/flags.ts by `pnpm --filter @smriti/config flags:export`. Do not edit.',
    flags,
    aliases: Object.fromEntries(Object.entries(aliases).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/** Defaults only (no server map yet): for first launch and tests. */
export const defaultFlags: Flags = createFlags({});

/** The flag map schema: a partial map of known keys to valid values. Unknown keys are rejected. */
export const flagMapSchema = z.strictObject(
    Object.fromEntries(FLAG_KEYS.map((k) => [k, z.optional(z.nullable(FLAG_REGISTRY[k].schema))])) as {
      [K in FlagKey]: z.ZodMiniOptional<z.ZodMiniNullable<(typeof FLAG_REGISTRY)[K]['schema']>>;
    },
);
export type FlagMap = z.infer<typeof flagMapSchema>;
