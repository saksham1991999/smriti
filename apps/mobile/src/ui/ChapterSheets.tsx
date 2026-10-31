import { ContentError } from '@smriti/app-core';
import type { IconName } from '@smriti/tokens/ui';
import { Banner, Button, Chip, Icon, PressableScale, ProgressBar, Sheet, Switch, Text, useTheme } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { megabytesLabel, type ChapterDownloadPlan } from '../content/downloads';
import type { ChapterView, ContentLocale, SubjectView, TopicView } from '../content/repo';
import { checkMinutes, testOutQuestions } from '../services/checks';
import { useApp, useQueryScope, useT, useUiState } from '../services/context';
import { fetchPracticeHub, practiceKeys } from '../services/practice';

/**
 * LRN-02's sheets: LRN-06 (chapter test), LRN-15 (download for offline), the reset confirm (X13)
 * and the long-press quick actions. Rules live in services (checks.ts, downloads.ts).
 */

export type ChapterChoice = 'test_out' | 'practise';

/** LRN-06: Test out (free, never uses the daily questions) or Practise. */
export function ChapterTestSheet({
  open,
  onOpenChange,
  chapter,
  defaultChoice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chapter: ChapterView;
  defaultChoice: ChapterChoice;
}) {
  const app = useApp();
  const t = useT();
  const scope = useQueryScope();
  const exam = app.examProfileId();
  const [choice, setChoice] = useState<ChapterChoice>(defaultChoice);
  useEffect(() => {
    if (open) setChoice(defaultChoice);
  }, [open, defaultChoice]);
  const questions = useMemo(() => (open ? testOutQuestions(app, chapter) : []), [app, chapter, open]);
  const minutes = checkMinutes(questions);
  const canTestOut = questions.length > 0;
  const hub = useQuery({ queryKey: practiceKeys.hub(scope, exam), queryFn: () => fetchPracticeHub(app), enabled: open && !app.isPro(), retry: 1 });
  const quota = hub.data?.limits.practice_questions;
  const left = quota && !quota.unlimited && quota.remaining !== null ? quota.remaining : null;
  const selected: ChapterChoice = choice === 'test_out' && !canTestOut ? 'practise' : choice;
  const start = () => {
    app.track('chapter_test_choice', { choice: selected });
    onOpenChange(false);
    if (selected === 'test_out') router.push({ pathname: '/check/[chapterId]', params: { chapterId: chapter.id } });
    else router.push({ pathname: '/drill', params: { chapter: chapter.id, source: 'chapter' } });
  };
  const testOutMeta = [t('learn:LRN-06.test_out_meta.1', { n: questions.length }), ...(minutes !== null ? [t('learn:LRN-06.test_out_meta.2', { minutes })] : [])].join(' · ');
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('learn:LRN-06.title')}
      description={chapter.name}
      height="60"
      testID="LRN-06"
      footer={<Button label={selected === 'test_out' ? t('learn:LRN-06.buttons.1') : t('learn:LRN-06.buttons.2')} onPress={start} fullWidth testID="chapter-test-start" />}
    >
      <View style={styles.gap} accessibilityRole="radiogroup">
        <ChoiceCard
          icon="Rocket"
          title={t('learn:LRN-06.test_out')}
          meta={canTestOut ? testOutMeta : null}
          line={canTestOut ? t('learn:LRN-06.test_out_line') : t('learn:LRN-06.no_questions')}
          quota={canTestOut ? t('learn:LRN-06.test_out_quota') : null}
          chip={canTestOut ? t('learn:LRN-06.free_chip') : null}
          selected={selected === 'test_out'}
          disabled={!canTestOut}
          onPress={() => setChoice('test_out')}
          testID="chapter-choice-test-out"
        />
        <ChoiceCard
          icon="Target"
          title={t('learn:LRN-06.practise')}
          meta={t('learn:LRN-06.practise_meta')}
          line={t('learn:LRN-06.practise_line')}
          quota={left !== null ? t('learn:LRN-06.practise_quota_free', { left }) : null}
          chip={null}
          selected={selected === 'practise'}
          onPress={() => setChoice('practise')}
          testID="chapter-choice-practise"
        />
      </View>
    </Sheet>
  );
}

function ChoiceCard(props: {
  icon: IconName;
  title: string;
  meta: string | null;
  line: string;
  quota: string | null;
  chip: string | null;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID: string;
}) {
  const theme = useTheme();
  const label = [props.title, props.meta, props.line, props.quota].filter(Boolean).join('. ');
  return (
    <PressableScale
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected, disabled: Boolean(props.disabled) }}
      accessibilityLabel={label}
      testID={props.testID}
      style={[
        styles.choice,
        {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.cardLarge,
          borderColor: props.selected ? theme.colors.primary : theme.colors.line,
          opacity: props.disabled ? 0.6 : 1,
        },
      ]}
    >
      <View style={styles.choiceHead}>
        <Icon name={props.icon} size={24} color={props.selected ? 'primary' : 'ink'} />
        <Text variant="heading" style={styles.grow}>
          {props.title}
        </Text>
        {props.selected ? <Icon name="CheckCircle" size={24} weight="fill" color="primary" /> : null}
      </View>
      {props.meta ? (
        <Text variant="caption" tone="muted" numeric>
          {props.meta}
        </Text>
      ) : null}
      <Text variant="body">{props.line}</Text>
      {props.chip || props.quota ? (
        <View style={styles.choiceFoot}>
          {props.chip ? <Chip label={props.chip} tone="success" /> : null}
          {props.quota ? (
            <Text variant="caption" tone="muted" style={styles.grow}>
              {props.quota}
            </Text>
          ) : null}
        </View>
      ) : null}
    </PressableScale>
  );
}

type DownloadPhase = 'idle' | 'downloading' | 'waiting' | 'error' | 'no_space' | 'done';

const otherLocale = (l: ContentLocale): ContentLocale => (l === 'en' ? 'hi' : 'en');

/** Rough size bands for `download_*.bytes_bucket` (never the exact size). */
function bytesBucket(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb < 5 ? 'lt_5mb' : mb < 20 ? '5_20mb' : mb < 100 ? '20_100mb' : 'gte_100mb';
}

/** LRN-15: pin this chapter (or the whole subject) on the device through ContentDownloads. */
export function DownloadSheet({
  open,
  onOpenChange,
  chapter,
  subject,
  onToast,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chapter: ChapterView;
  subject: SubjectView;
  onToast: (message: string) => void;
}) {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const online = useUiState(() => app.deps.network.isOnline());
  const downloads = app.deps.downloads ?? null;
  const exam = app.examProfileId();
  const [scope, setScope] = useState<'chapter' | 'subject'>('chapter');
  const [wifiOnly, setWifiOnly] = useState(true);
  const [both, setBoth] = useState(false);
  const [plan, setPlan] = useState<ChapterDownloadPlan | null>(null);
  const [usage, setUsage] = useState<{ total: number; limit: number } | null>(null);
  const [phase, setPhase] = useState<DownloadPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [tick, setTick] = useState(0);
  const cancel = useRef({ cancelled: false });
  const locales = useMemo<ContentLocale[]>(() => (both ? [locale, otherLocale(locale)] : [locale]), [both, locale]);

  useEffect(() => {
    if (!open || !downloads) return;
    let live = true;
    const target = scope === 'chapter' ? { id: chapter.id, kind: 'chapter' as const, chapters: [chapter] } : { id: subject.id, kind: 'subject' as const, chapters: subject.chapters };
    void downloads.plan(target, locales, exam).then((p) => live && setPlan(p));
    void downloads.usage().then((u) => live && setUsage({ total: u.totalBytes, limit: u.limitBytes }));
    return () => {
      live = false;
    };
  }, [open, downloads, scope, chapter, subject, locales, exam, tick]);

  useEffect(() => {
    if (!open) {
      cancel.current.cancelled = true;
      setPhase('idle');
      setProgress(0);
    }
  }, [open]);

  const builtIn = plan?.state === 'built_in';
  const downloaded = plan?.state === 'downloaded';
  const unavailable = !downloads || !downloads.configured() || !online;

  const start = async () => {
    if (!downloads || !plan) return;
    if (wifiOnly && app.deps.connection?.isCellular()) {
      setPhase('waiting');
      return;
    }
    if (usage && usage.total + plan.missingBytes > usage.limit) {
      setPhase('no_space');
      return;
    }
    cancel.current = { cancelled: false };
    setPhase('downloading');
    app.track('download_started', { scope: plan.scope, bytes_bucket: bytesBucket(plan.missingBytes) });
    try {
      await downloads.download(plan, exam, setProgress, cancel.current);
      if (cancel.current.cancelled) return;
      app.track('download_completed', { scope: plan.scope, bytes_bucket: bytesBucket(plan.missingBytes) });
      setPhase('done');
      onToast(t('learn:LRN-15.done_toast'));
      onOpenChange(false);
    } catch (e) {
      const code = e instanceof ContentError ? e.code : 'unknown';
      app.track('download_failed', { scope: plan.scope, bytes_bucket: bytesBucket(plan.missingBytes), error_code: code });
      setPhase(code === 'storage_full' ? 'no_space' : 'error');
    } finally {
      setTick((n) => n + 1);
    }
  };

  const remove = async () => {
    if (!downloads || !plan) return;
    await downloads.remove(plan);
    setTick((n) => n + 1);
    onToast(t('learn:LRN-15.removed_toast'));
    onOpenChange(false);
  };

  const size = (bytes: number) => megabytesLabel(bytes);
  const footer =
    phase === 'downloading' ? (
      <View style={styles.gap}>
        <ProgressBar value={progress} label={t('learn:LRN-15.progress.1', { percent: Math.round(progress * 100) })} />
        <Text variant="label" numeric>
          {t('learn:LRN-15.progress.1', { percent: Math.round(progress * 100) })}
        </Text>
        <Button
          variant="ghost"
          label={t('learn:LRN-15.progress.2')}
          onPress={() => {
            cancel.current.cancelled = true;
            setPhase('idle');
          }}
          fullWidth
          testID="download-pause"
        />
      </View>
    ) : builtIn ? (
      <Button variant="secondary" label={t('learn:LRN-15.built_in')} disabled onPress={() => undefined} fullWidth testID="download-built-in" />
    ) : downloaded ? (
      <Button variant="destructive" icon="Trash" label={t('learn:LRN-15.remove')} onPress={() => void remove()} fullWidth testID="download-remove" />
    ) : (
      <Button icon="DownloadSimple" label={t('learn:LRN-15.button')} disabled={unavailable || !plan} onPress={() => void start()} fullWidth testID="download-start" />
    );

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('learn:LRN-15.title')} height="60" testID="LRN-15" footer={footer}>
      <View style={styles.gap} accessibilityRole="radiogroup">
        <ScopeRow
          selected={scope === 'chapter'}
          title={t('learn:LRN-15.scope.1')}
          meta={plan && scope === 'chapter' ? `${t('learn:LRN-15.scope.2', { size: size(plan.totalBytes) })} · ${t('learn:LRN-15.scope.3', { n: plan.lessons })}` : null}
          onPress={() => setScope('chapter')}
          testID="download-scope-chapter"
        />
        <ScopeRow
          selected={scope === 'subject'}
          title={t('learn:LRN-15.scope.4', { subject_name: subject.name })}
          meta={plan && scope === 'subject' ? t('learn:LRN-15.scope.5', { size: size(plan.totalBytes) }) : null}
          onPress={() => setScope('subject')}
          testID="download-scope-subject"
        />
        {builtIn ? <Chip icon="CheckCircle" tone="success" label={t('learn:LRN-15.built_in')} testID="download-state-built-in" /> : null}
        {downloaded ? <Chip icon="CloudCheck" tone="success" label={t('learn:LRN-15.downloaded_chip')} testID="download-state-downloaded" /> : null}
        <Switch label={t('learn:LRN-15.wi_fi')} checked={wifiOnly} onCheckedChange={setWifiOnly} testID="download-wifi-only" />
        <Switch label={t('learn:LRN-15.language', { other_language: otherLocale(locale) === 'en' ? t('learn:LRN-15.language_names.1') : t('learn:LRN-15.language_names.2') })} checked={both} onCheckedChange={setBoth} testID="download-both-languages" />
        {usage ? (
          <Text variant="caption" tone="muted" numeric testID="download-storage">
            {t('learn:LRN-15.storage.1', { x: `${size(usage.total)} MB`, y: `${size(usage.limit)} MB` })}
          </Text>
        ) : null}
        {unavailable && !builtIn ? <Banner tone="info" icon="WifiSlash" text={t('learn:LRN-15.offline')} testID="download-offline" /> : null}
        {phase === 'waiting' ? <Banner tone="info" icon="WifiSlash" text={t('learn:LRN-15.waiting')} testID="download-waiting" /> : null}
        {phase === 'no_space' && plan ? <Banner tone="warning" icon="Warning" text={t('learn:LRN-15.no_space', { size: size(plan.missingBytes) })} testID="download-no-space" /> : null}
        {phase === 'error' ? <Banner tone="warning" icon="Warning" text={t('learn:LRN-15.failed')} testID="download-failed" /> : null}
      </View>
    </Sheet>
  );
}

function ScopeRow({ selected, title, meta, onPress, testID }: { selected: boolean; title: string; meta: string | null; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={meta ? `${title}, ${meta}` : title}
      testID={testID}
      style={[styles.scope, { borderColor: selected ? theme.colors.primary : theme.colors.line, borderRadius: theme.radius.card, backgroundColor: theme.colors.surface }]}
    >
      <Icon name={selected ? 'CheckCircle' : 'Circle'} size={24} weight={selected ? 'fill' : 'regular'} color={selected ? 'primary' : 'inkMuted'} />
      <View style={styles.grow}>
        <Text variant="label">{title}</Text>
        {meta ? (
          <Text variant="caption" tone="muted" numeric>
            {meta}
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
}

/** X13: Reset chapter progress, a two-step destructive action. */
export function ResetSheet({ open, onOpenChange, chapter, onReset }: { open: boolean; onOpenChange: (open: boolean) => void; chapter: ChapterView; onReset: () => void }) {
  const t = useT();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('learn:LRN-02.reset_title', { chapter_title: chapter.name })}
      description={t('learn:LRN-02.reset_body')}
      height="40"
      testID="LRN-02-reset"
      footer={
        <View style={styles.gap}>
          <Button variant="destructive" label={t('learn:LRN-02.reset_buttons.1')} onPress={onReset} fullWidth testID="chapter-reset-confirm" />
          <Button variant="ghost" label={t('learn:LRN-02.reset_buttons.2')} onPress={() => onOpenChange(false)} fullWidth testID="chapter-reset-cancel" />
        </View>
      }
    >
      <View />
    </Sheet>
  );
}

/** Long-press on a topic row: Quick revision, Download, Mark as learned. */
export function TopicActionsSheet({
  topic,
  learned,
  onOpenChange,
  onQuickRevision,
  onDownload,
  onMarkLearned,
}: {
  topic: TopicView | null;
  learned: boolean;
  onOpenChange: (open: boolean) => void;
  onQuickRevision: (t: TopicView) => void;
  onDownload: () => void;
  onMarkLearned: (t: TopicView) => void;
}) {
  const t = useT();
  return (
    <Sheet open={topic !== null} onOpenChange={onOpenChange} title={topic?.name ?? ''} height="40" testID="LRN-02-actions">
      {topic ? (
        <View style={styles.gap}>
          {topic.hasQuickRevision ? <Button variant="ghost" icon="Lightning" label={t('learn:LRN-02.long_press_actions.1')} onPress={() => onQuickRevision(topic)} testID="topic-action-quick" /> : null}
          <Button variant="ghost" icon="DownloadSimple" label={t('learn:LRN-02.long_press_actions.2')} onPress={onDownload} testID="topic-action-download" />
          {learned ? null : <Button variant="ghost" icon="Rocket" label={t('learn:LRN-02.long_press_actions.3')} onPress={() => onMarkLearned(topic)} testID="topic-action-mark" />}
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 12 },
  grow: { flex: 1 },
  choice: { borderWidth: 2, padding: 16, gap: 8 },
  choiceHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  choiceFoot: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  scope: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 2, minHeight: 56 },
});
