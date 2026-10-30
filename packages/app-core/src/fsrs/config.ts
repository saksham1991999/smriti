import { defaultFlags, type Flags } from '@smriti/config';

import type { ComebackConfig } from './comeback';
import type { QueueConfig } from './queue';
import type { SchedulerOptions } from './scheduler';

/** Memory settings resolved from flags, so web and mobile build the queue the same way. */
export interface MemoryConfig {
  queue: QueueConfig;
  comeback: ComebackConfig;
  scheduler: Required<Pick<SchedulerOptions, 'maximumIntervalDays' | 'enableFuzz'>>;
  rescueCards: number;
  queueFromPracticeMax: number;
  leechLapses: number;
  sessionSize: number;
}

export function memoryConfigFromFlags(flags: Flags = defaultFlags): MemoryConfig {
  const sessionSize = flags.get('memory.session_size');
  return {
    queue: { newCardsPerDay: flags.get('memory.new_cards_per_day'), dailyReviewCap: flags.get('memory.daily_review_cap') },
    comeback: {
      minDue: flags.get('memory.comeback.min_due'),
      relearnBelow: flags.get('memory.comeback.relearn_below'),
      firstSession: flags.get('memory.comeback.first_session'),
      planLengths: flags.get('memory.comeback.plan_lengths'),
      sessionSize,
      defaultSecondsPerCard: flags.get('memory.default_seconds_per_card'),
    },
    scheduler: { maximumIntervalDays: flags.get('memory.fsrs.maximum_interval_days'), enableFuzz: flags.get('memory.fsrs.enable_fuzz') },
    rescueCards: flags.get('memory.rescue_cards'),
    queueFromPracticeMax: flags.get('memory.queue_from_practice_max'),
    leechLapses: flags.get('memory.leech_lapses'),
    sessionSize,
  };
}
