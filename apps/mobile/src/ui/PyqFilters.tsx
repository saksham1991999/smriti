import { Button, ChoiceChips, Sheet, Text } from '@smriti/ui-native';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useT } from '../services/context';
import type { PyqFilters, PyqQuestion } from '../services/drill';

const TYPE_LABEL: Record<string, string> = { mcq_single: 'single_correct', mcq_multi: 'multiple_correct', numerical: 'numerical', integer: 'numerical' };

/** Applies PRC-08 filters to a list the device already has (the count updates live). */
export function applyPyqFilters(items: PyqQuestion[], f: PyqFilters): PyqQuestion[] {
  return items.filter(
    (q) =>
      (!f.year?.length || f.year.includes(q.year)) &&
      (!f.session || q.session_label === f.session) &&
      (!f.subject || q.subject_id === f.subject) &&
      (!f.chapter || q.chapter_id === f.chapter) &&
      (!f.difficulty || q.difficulty === f.difficulty) &&
      (!f.type || q.type === f.type) &&
      (!f.status || q.status === f.status),
  );
}

export function activeFilterCount(f: PyqFilters): number {
  return [f.year?.length, f.session, f.subject, f.chapter, f.difficulty, f.type, f.status].filter(Boolean).length;
}

/**
 * PRC-08, PYQ filters as a full sheet. The groups are built from the PYQs that exist (years,
 * sessions and types present), never a fixed list.
 */
export function PyqFilterSheet({ open, onOpenChange, items, value, onApply }: { open: boolean; onOpenChange: (o: boolean) => void; items: PyqQuestion[]; value: PyqFilters; onApply: (f: PyqFilters) => void }) {
  const t = useT();
  const [f, setF] = useState<PyqFilters>(value);
  const years = useMemo(() => [...new Set(items.map((q) => q.year))].sort((a, b) => b - a), [items]);
  const sessions = useMemo(() => [...new Set(items.filter((q) => !f.year?.length || f.year.includes(q.year)).map((q) => q.session_label).filter((s): s is string => Boolean(s)))], [items, f.year]);
  const types = useMemo(() => [...new Set(items.map((q) => q.type))], [items]);
  const count = applyPyqFilters(items, f).length;
  const one = <T,>(v: string[]) => (v[0] ?? null) as T | null;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('practice:PRC-08.title')}
      height="full"
      testID="PRC-08"
      footer={
        <View style={styles.gap}>
          {count === 0 ? (
            <Text variant="caption" tone="muted" align="center">
              {t('practice:PRC-08.none')}
            </Text>
          ) : null}
          <Button label={t('practice:PRC-08.show', { n: count })} disabled={count === 0} onPress={() => (onApply(f), onOpenChange(false))} testID="filters-show" />
        </View>
      }
    >
      <View style={styles.gap}>
        <Button variant="ghost" size="sm" label={t('practice:PRC-08.reset')} onPress={() => setF({})} testID="filters-reset" />
        {years.length ? <ChoiceChips label={t('practice:PRC-08.year')} multiple options={years.map((y) => ({ value: String(y), label: String(y) }))} value={(f.year ?? []).map(String)} onChange={(v) => setF({ ...f, year: v.map(Number), session: null })} testID="filters-year" /> : null}
        {sessions.length > 1 ? <ChoiceChips label={t('practice:PRC-08.shift')} options={sessions.map((s) => ({ value: s, label: s }))} value={f.session ? [f.session] : []} onChange={(v) => setF({ ...f, session: one<string>(v) })} /> : null}
        <ChoiceChips
          label={t('practice:PRC-08.difficulty')}
          options={(['easy', 'medium', 'hard'] as const).map((d) => ({ value: d, label: t(`practice:PRC-03.${d}`) }))}
          value={f.difficulty ? [f.difficulty] : []}
          onChange={(v) => setF({ ...f, difficulty: one<'easy' | 'medium' | 'hard'>(v) })}
        />
        <Text variant="caption" tone="muted">
          {t('practice:PRC-08.estimate_caption')}
        </Text>
        {types.length > 1 ? (
          <ChoiceChips
            label={t('practice:PRC-08.question_type')}
            options={types.map((ty) => ({ value: ty, label: TYPE_LABEL[ty] ? t(`practice:PRC-08.${TYPE_LABEL[ty]}` as 'practice:PRC-08.numerical') : ty }))}
            value={f.type ? [f.type] : []}
            onChange={(v) => setF({ ...f, type: one<string>(v) })}
          />
        ) : null}
        <ChoiceChips
          label={t('practice:PRC-08.status')}
          options={(['not_tried', 'wrong', 'correct'] as const).map((s) => ({ value: s, label: t(`practice:PRC-08.${s}`) }))}
          value={f.status ? [f.status] : []}
          onChange={(v) => setF({ ...f, status: one<'not_tried' | 'wrong' | 'correct'>(v) })}
          testID="filters-status"
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({ gap: { gap: 12 } });
