import { ApiError } from '@smriti/api-client';
import { Banner, Button, ChoiceChips } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useQueryScope, useT, useUiState } from '../src/services/context';
import { generateMock } from '../src/services/mocks';
import { fetchPracticeHub, practiceKeys } from '../src/services/practice';
import { BackHeader, Screen } from '../src/ui/Screen';

const COUNTS = [5, 10, 20, 30];

/**
 * MOCK-26: a mock built by the server (`/v1/mocks/generate`) from weak spots or chosen chapters,
 * with the exam's own marking and timing. A free student gets the paywall from the server's 403.
 */
export default function CustomMock() {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const scope = useQueryScope();
  const exam = app.examProfileId();
  const hub = useQuery({ queryKey: practiceKeys.hub(scope, exam), queryFn: () => fetchPracticeHub(app) });
  const chapters = useMemo(() => app.deps.content.subjects(locale, exam).flatMap((s) => s.chapters), [app, locale, exam]);
  const weak = hub.data?.weak_spots ?? [];
  const [scopeKind, setScopeKind] = useState<'weak' | 'chapter'>(weak.length > 0 ? 'weak' : 'chapter');
  const [chapter, setChapter] = useState<string | null>(null);
  const [count, setCount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const a =
        scopeKind === 'weak'
          ? await generateMock(app, { kind: 'custom', exam, concepts: weak.map((w) => w.concept_id), question_count: count, language: locale, time_policy: 'practice' })
          : await generateMock(app, { kind: 'chapter', exam, chapter_id: chapter ?? chapters[0]?.id ?? null, question_count: count, language: locale, time_policy: 'practice' });
      router.replace({ pathname: '/attempt/[id]', params: { id: a.id } });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 403) router.push({ pathname: '/paywall', params: { from: 'custom_mock' } });
      else setProblem(status === 409 || status === 422 ? t('practice:MOCK-26.too_few') : t('learn:LES-11.error'));
    }
    setBusy(false);
  };

  return (
    <Screen testID="MOCK-26" footer={<Button label={busy ? t('practice:MOCK-26.creating') : t('practice:MOCK-26.create')} loading={busy} disabled={scopeKind === 'chapter' && chapters.length === 0} onPress={() => void create()} testID="custom-create" />}>
      <BackHeader title={t('practice:MOCK-26.title')} backLabel={t('ui:common.back')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/mocks' as Href))} />
      <ChoiceChips
        label={t('practice:MOCK-26.title')}
        hideLabel
        options={[...(weak.length > 0 ? [{ value: 'weak', label: t('practice:MOCK-26.my_weak_spots') }] : []), { value: 'chapter', label: t('practice:MOCK-26.pick_chapters') }]}
        value={[scopeKind]}
        onChange={(v) => setScopeKind(((Array.isArray(v) ? v[0] : v) as 'weak' | 'chapter') ?? 'chapter')}
        testID="custom-scope"
      />
      {scopeKind === 'chapter' && chapters.length > 0 ? (
        <ChoiceChips label={t('practice:MOCK-26.pick_chapters')} options={chapters.map((c) => ({ value: c.id, label: c.name }))} value={[chapter ?? chapters[0]!.id]} onChange={(v) => setChapter((Array.isArray(v) ? v[0] : v) ?? null)} testID="custom-chapters" />
      ) : null}
      <View style={styles.gap}>
        <ChoiceChips label={t('practice:MOCK-26.questions')} options={COUNTS.map((n) => ({ value: String(n), label: String(n) }))} value={[String(count)]} onChange={(v) => setCount(Number((Array.isArray(v) ? v[0] : v) ?? 10))} testID="custom-count" />
      </View>
      {problem ? <Banner tone="warning" icon="Warning" text={problem} testID="custom-problem" /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ gap: { gap: 8 } });
