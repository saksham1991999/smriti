import { checkAnswer, currentCard, type Answer, type AnyQuestion, type LessonState } from '@smriti/lesson-core';

import type { LessonRun } from '../src/services/lessons';

/** A right answer for any question type, built from the question's own key (test helper only). */
export function rightAnswer(q: AnyQuestion): Answer {
  switch (q.type) {
    case 'mcq_single':
    case 'mcq_multi':
    case 'assertion_reason':
    case 'statement_based':
      return { kind: 'options', optionIds: q.answer.option_ids };
    case 'integer':
      return { kind: 'number', value: q.answer.value } as Answer;
    case 'match_list':
      return 'option_ids' in q.answer ? { kind: 'options', optionIds: q.answer.option_ids } : { kind: 'pairs', pairs: q.answer.pairs };
    case 'order_steps':
      return { kind: 'order', order: q.answer.order };
    case 'numerical':
      return { kind: 'number', value: q.answer.value, unit: q.answer.unit ?? null };
    case 'matrix_match':
      return { kind: 'matrix', rows: q.answer.pairs.map((p) => ({ row: p.row, columns: p.columns })) };
    case 'fill_blank':
      return {
        kind: 'blanks',
        blanks: q.answer.blanks.map((b) => {
          const key = b as { blank: string; choice_id?: string; accepted?: { text: string[] }[] };
          return key.choice_id ? { blank: key.blank, choiceId: key.choice_id } : { blank: key.blank, text: key.accepted?.[0]?.text[0] ?? '' };
        }),
      };
    default:
      throw new Error(`rightAnswer: no helper for ${q.type}`);
  }
}

/**
 * Plays a lesson to the end headlessly: right answers, tasks skipped, "Sure" at LES-07.
 * Returns the final state.
 */
export function playToEnd(run: LessonRun): LessonState {
  const s = run.session;
  s.dispatch({ type: 'start', plan: run.plan });
  for (let guard = 0; guard < 200; guard++) {
    const st = s.state;
    switch (st.phase) {
      case 'card':
        if (st.pendingTask) s.dispatch({ type: 'skip_task' });
        if (currentCard(st)?.onlineOnly) s.dispatch({ type: 'skip_online' });
        else s.dispatch({ type: 'next' });
        break;
      case 'question': {
        const q = currentCard(st)!.question!;
        const answer = rightAnswer(q);
        if (!checkAnswer(q, answer).correct) throw new Error(`helper answer for ${q.id} is wrong`);
        s.dispatch({ type: 'submit', answer, confidence: 'sure' });
        break;
      }
      case 'feedback':
      case 'explain':
        s.dispatch({ type: 'continue' });
        break;
      case 'hint':
        s.dispatch({ type: 'try_again' });
        break;
      case 'confidence':
        s.dispatch({ type: 'confidence', value: 'sure' });
        break;
      default:
        return st;
    }
  }
  throw new Error('lesson did not finish');
}
