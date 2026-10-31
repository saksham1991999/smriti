import { PET_STATES, addDays, buildLocalPlan, zonedInstant, type PetState, type PlanItem, type WidgetPlanItem, type WidgetSnapshot } from '@smriti/app-core';

import type { SmritiApp } from './app';
import { loadTopicStates } from './progress';

/**
 * The live parts of the widget snapshot (NTF-09, NTF-10), gathered from the device: the pet's
 * state, today's due cards from the FSRS queue, today's plan (app-core `buildLocalPlan`) and the
 * exam. `SmritiApp.writeWidget` adds the rest.
 */
export interface WidgetData {
  petState: PetState;
  dueCards: number;
  planItems: WidgetPlanItem[];
  exam: WidgetSnapshot['exam'];
}

const isPetState = (s: string): s is PetState => (PET_STATES as readonly string[]).includes(s);

export async function widgetData(app: SmritiApp): Promise<WidgetData> {
  const st = app.store.getState();
  const locale = app.ui.getState().locale;
  const exam = app.examProfileId();
  const today = app.today();

  // Due by the end of today, capped like the review session (memory-labs §5.1).
  const endOfToday = new Date(zonedInstant(addDays(today, 1), 0, app.deps.timeZone()) - 1).toISOString();
  const due = await app.deps.stores.storage.srs_cards.dueBefore(endOfToday);
  const dueCards = Math.min(due.length, app.flags.get('memory.daily_review_cap'));

  const states = await loadTopicStates(app);
  const next = [...states.values()].find((s) => s.status !== 'learned' && s.topic.hasDeepDive) ?? null;
  const plan = buildLocalPlan({
    day: today,
    goalMinutes: st.profile?.daily_goal_minutes ?? app.ui.getState().onboarding.dailyGoalMinutes ?? 10,
    reviewsDue: dueCards,
    comebackActive: false,
    secondsPerCard: app.flags.get('memory.default_seconds_per_card'),
    newTopic: next ? { topicId: next.topic.id, minutes: next.topic.minutes ?? 5, mode: 'deep_dive' } : null,
    drill: null,
    mock: null,
    dailyChallengeOpen: false,
  });

  const item = (i: PlanItem): WidgetPlanItem | null => {
    if (i.kind === 'review') {
      return { title: app.t('learn:HOME-02.item_reviews', { n: i.ref.cards ?? dueCards }), subject_family: 'memory', minutes: i.minutes, deep_link: '/memory' };
    }
    if ((i.kind === 'learn' || i.kind === 'revise') && i.ref.topicId) {
      const topic = states.get(i.ref.topicId)?.topic;
      if (!topic) return null;
      return {
        title: app.t(i.kind === 'learn' ? 'learn:HOME-02.item_learn' : 'learn:HOME-02.item_revise', { topic_title: topic.name }),
        subject_family: app.deps.content.subjectOf(locale, topic.id, exam)?.colorFamily ?? 'default',
        minutes: i.minutes,
        deep_link: `/lesson/${topic.id}`,
      };
    }
    return null;
  };

  return {
    petState: st.pet && isPetState(st.pet.state) ? st.pet.state : 'happy',
    dueCards,
    planItems: plan.items.map(item).filter((i): i is WidgetPlanItem => i !== null),
    // The app does not keep an exam date yet (ONB exam_date is not stored on the device), so the
    // large widget shows "Set your exam date" rather than a made-up countdown.
    exam: null,
  };
}
