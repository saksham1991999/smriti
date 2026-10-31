import type { HostEvent, HostSession, MeasurementPayload, Reading, TaskProgress } from '@smriti/sim-bridge';
import { Banner, Button, Card, Chip, Dialog, Icon, IconButton, Illustration, ProgressBar, Sheet, Spinner, StatTile, Switch, Text, Toast, useTheme, useUI } from '@smriti/ui-native';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LABS, labAspect, labIllustration, type LabEntry } from '../../../src/content/labs';
import { useApp, useT, useUiState } from '../../../src/services/context';
import { clock } from '../../../src/services/drill';
import { formatReading, labLessonText, megabytes, nextLab, saveLabProgress, simCache, type SimLocation } from '../../../src/services/labs';
import { useHaptics } from '../../../src/ui/hooks';
import { BuddyLine } from '../../../src/ui/Onboarding';
import { Screen } from '../../../src/ui/Screen';
import { SimView } from '../../../src/ui/SimView';

type Phase = 'preparing' | 'loading' | 'running' | 'slow' | 'complete' | 'fallback';
type FallbackReason = 'offline' | 'failed';

const MIN_SIM_HEIGHT = 320;
/** LAB-04 full screen: the side panel's width, and the width below which it starts collapsed. */
const PANEL_WIDTH = 280;
const PANEL_TAB = 48;
const WIDE = 600;
const MAX_SIM_HEIGHT = 2000;

/**
 * LAB-04, the sim player, with its states: the loading layer (download with real bytes, then
 * "Setting up"), the slow-start offer, one automatic restart in battery saver after a crash, then
 * LAB-05 (fallback), LAB-06 (readings sheet) and LAB-07 (complete). The sim draws its own scene
 * and controls; the shell holds readings, tasks and the one primary action. Free and Pro are the
 * same (R19).
 */
export default function LabPlayer() {
  const app = useApp();
  const t = useT();
  const theme = useTheme();
  const ui = useUI();
  const haptics = useHaptics();
  const queries = useQueryClient();
  const locale = useUiState((s) => s.locale);
  const params = useLocalSearchParams<{ id: string; fallback?: string }>();
  const lab = LABS.find((l) => l.id === params.id);
  const cache = useMemo(() => simCache(app), [app]);
  const little = app.isLittleLearner();

  const [phase, setPhase] = useState<Phase>(params.fallback ? 'fallback' : 'preparing');
  const [reason, setReason] = useState<FallbackReason>(params.fallback === 'offline' ? 'offline' : 'failed');
  const [location, setLocation] = useState<SimLocation | null>(null);
  const [bytes, setBytes] = useState(0);
  const [lowPower, setLowPower] = useState(little);
  const [mount, setMount] = useState(0);
  const [readings, setReadings] = useState<readonly Reading[]>([]);
  const [tasks, setTasks] = useState<TaskProgress[]>([]);
  const [rows, setRows] = useState<readonly MeasurementPayload[]>([]);
  const [current, setCurrent] = useState(0);
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  /** The sim's content height from its `resize` messages: the viewport grows and the screen scrolls. */
  const [simHeight, setSimHeight] = useState<number | null>(null);
  /** LAB-04 [Expand]: the viewport fills the screen and tasks move to a side panel. Same WebView, state kept. */
  const [full, setFull] = useState(false);
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [panelOpen, setPanelOpen] = useState(window.width >= WIDE);
  const session = useRef<HostSession | null>(null);
  const crashes = useRef(0);
  const startedAt = useRef(app.now());
  const loadStarted = useRef(app.now());

  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/lab/[id]', params: { id: lab?.id ?? '' } }));

  const fallback = useCallback(
    (why: FallbackReason, analytics: 'offline' | 'download' | 'timeout' | 'crash' | 'unsupported') => {
      if (!lab) return;
      setReason(why);
      setPhase('fallback');
      app.track('sim_load_failed', { sim_id: lab.id, reason: analytics });
      app.track('lab_fallback_shown', { lab_id: lab.id, reason: why });
    },
    [app, lab],
  );

  // Find or download the sim, then mount the viewer.
  useEffect(() => {
    if (!lab || phase !== 'preparing') return;
    let alive = true;
    const cached = cache.isCached(lab);
    app.track('sim_load_started', { sim_id: lab.id, cached: String(cached), size_kb: String(Math.round((lab.sizeBytes ?? 0) / 1024)), tier: lowPower ? 'low' : 'normal' });
    loadStarted.current = app.now();
    void cache.prepare(lab, app.deps.network.isOnline(), (b) => alive && setBytes(b)).then((r) => {
      if (!alive) return;
      if (typeof r === 'string') {
        fallback(r === 'offline' ? 'offline' : 'failed', r === 'offline' ? 'offline' : r === 'download' ? 'download' : 'unsupported');
        return;
      }
      setLocation(r);
      setPhase('loading');
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lab, phase]);

  // Pause while the app is in the background (LAB-04 "Paused").
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      const live = session.current;
      if (!live) return;
      if (s !== 'active' && live.status === 'running') {
        live.pause();
        setPaused(true);
      }
    });
    return () => sub.remove();
  }, []);

  const onEvent = useCallback(
    (e: HostEvent) => {
      const live = session.current;
      if (!lab) return;
      switch (e.kind) {
        case 'ready':
          setPhase('running');
          setReadings(e.payload.readings);
          app.track('sim_ready', { sim_id: lab.id, load_ms: Math.round(app.now() - loadStarted.current), tier: lowPower ? 'low' : 'normal', low_power: String(lowPower) });
          return;
        case 'timeout':
          setPhase((p) => (p === 'loading' ? 'slow' : p));
          return;
        case 'crashed':
          crashes.current += 1;
          if (crashes.current === 1) {
            setToast(t('memory_labs:LAB-04.crashed'));
            setLowPower(true);
            setPhase('loading');
            setMount((n) => n + 1);
          } else fallback('failed', 'crash');
          return;
        case 'message':
          if (e.message.type === 'state') setReadings(e.message.payload.readings);
          if (e.message.type === 'resize') setSimHeight(Math.max(MIN_SIM_HEIGHT, Math.min(MAX_SIM_HEIGHT, Math.ceil(e.message.payload.height))));
          if (e.message.type === 'measurement' && live) {
            setRows([...live.measurements]);
            setToast(t('memory_labs:LAB-04.recorded'));
            app.track('lab_reading_recorded', { lab_id: lab.id, quantity: e.message.payload.name, unit: e.message.payload.unit || 'none' });
          }
          return;
        case 'task': {
          if (!live) return;
          const all = live.taskProgress();
          setTasks(all);
          const p = e.progress;
          if (p.status === 'correct') haptics.success();
          if (p.status === 'wrong') haptics.warning();
          if (p.status === 'correct' || p.status === 'wrong') {
            app.track('lab_task_result', { lab_id: lab.id, task_id: p.taskId, correct: p.status === 'correct' ? 1 : 0, tries: String(p.tries), checked_by: p.checkedBy ?? 'sim' });
          }
          void saveLabProgress(app, lab.id, all, false);
          return;
        }
        default:
          return;
      }
    },
    [app, fallback, haptics, lab, lowPower, t],
  );

  const onHost = useCallback(
    (s: HostSession | null) => {
      session.current = s;
      if (s) {
        setTasks(s.taskProgress());
        setRows([...s.measurements]);
      }
    },
    [],
  );

  // Android back leaves full screen before it leaves the lab.
  useEffect(() => {
    if (!full) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setFull(false);
      return true;
    });
    return () => sub.remove();
  }, [full]);

  // Locale and theme changes reach a running sim without a reload.
  const dark = ui.mode === 'dark';
  useEffect(() => {
    session.current?.setParams({ locale, theme: dark ? 'dark' : 'light', reducedMotion: ui.reducedMotion });
  }, [locale, dark, ui.reducedMotion]);

  if (!lab) {
    return (
      <Screen testID="LAB-04-missing" footer={<Button variant="secondary" label={t('ui:common.back')} onPress={() => router.replace('/labs' as Href)} fullWidth />}>
        <Illustration name="ui-offline" decorative width={200} height={150} />
      </Screen>
    );
  }

  if (phase === 'fallback') {
    return (
      <LabFallback
        lab={lab}
        reason={reason}
        canRetry={reason === 'failed' || app.deps.network.isOnline()}
        onRetry={() => {
          crashes.current = 0;
          setLowPower(true);
          setPhase('preparing');
          setMount((n) => n + 1);
        }}
        onContinue={back}
      />
    );
  }

  const done = tasks.filter((x) => x.status === 'correct').length;
  const skipped = tasks.filter((x) => x.status === 'skipped').length;
  const total = lab.taskSpecs.length;

  if (phase === 'complete') {
    return <LabComplete lab={lab} done={done} skipped={skipped} total={total} readings={rows.length} ms={app.now() - startedAt.current} />;
  }

  const task = lab.taskSpecs[current];
  const progress = task ? tasks.find((x) => x.taskId === task.id) : undefined;
  const settled = progress?.status === 'correct' || progress?.status === 'skipped';
  const allSettled = total > 0 && tasks.length === total && tasks.every((x) => x.status === 'correct' || x.status === 'skipped');
  const hint = task && session.current?.shouldShowHint(task.id) ? task.hint?.[locale] : undefined;
  const running = phase === 'running';

  const finish = () => {
    void saveLabProgress(app, lab.id, tasks, true);
    app.track('lab_completed', { lab_id: lab.id, tasks_done: String(done), tasks_skipped: String(skipped), duration_ms: Math.round(app.now() - startedAt.current) });
    void queries.invalidateQueries({ queryKey: ['smriti', 'lab-progress'] });
    setPhase('complete');
  };
  const goNext = () => {
    const nextIdx = lab.taskSpecs.findIndex((s, i) => i > current && !tasks.some((x) => x.taskId === s.id && (x.status === 'correct' || x.status === 'skipped')));
    const idx = nextIdx >= 0 ? nextIdx : lab.taskSpecs.findIndex((s) => !tasks.some((x) => x.taskId === s.id && (x.status === 'correct' || x.status === 'skipped')));
    if (idx < 0) return finish();
    setCurrent(idx);
    session.current?.setActiveTask(lab.taskSpecs[idx]!.id);
  };
  const primary = allSettled ? (
    <Button label={t('memory_labs:LAB-04.finish')} icon="Check" fullWidth onPress={finish} testID="lab-finish" />
  ) : settled ? (
    <Button label={t('memory_labs:LAB-04.next')} icon="ArrowRight" iconPosition="end" fullWidth onPress={goNext} testID="lab-next" />
  ) : (
    <Button label={t('memory_labs:LAB-04.check')} fullWidth disabled={!running || !task} onPress={() => task && session.current?.check(task.id)} testID="lab-check" />
  );

  const simLabel = lab.title[locale];
  const toggleFull = () => {
    const on = !full;
    setFull(on);
    if (on) setPanelOpen(window.width >= WIDE);
    app.track('sim_expanded', { sim_id: lab.id, orientation: window.width > window.height ? 'landscape' : 'portrait', on });
  };
  // Full screen: the stage fills the window below the safe area (the Screen's padding is 12 + 24).
  const stageHeight = Math.max(MIN_SIM_HEIGHT, window.height - insets.top - Math.max(insets.bottom, 16) - 36);
  const viewportStyle = full
    ? [styles.viewportFull, { backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.card }]
    : [styles.viewport, simHeight && running ? { height: simHeight } : { aspectRatio: labAspect(lab) }, { backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.card }];

  return (
    <Screen testID="LAB-04" footer={full ? undefined : primary}>
      {full ? null : (
        <View style={styles.top}>
          <IconButton icon="X" label={t('ui:common.close')} onPress={back} testID="lab-close" />
          <Text variant="heading" heading numberOfLines={1} style={styles.grow}>
            {simLabel}
          </Text>
          <IconButton icon="DotsThreeVertical" label={t('ui:common.moreOptions')} onPress={() => setMenu(true)} testID="lab-menu" />
        </View>
      )}

      <View style={full ? [styles.stage, { height: stageHeight }] : styles.gapLarge} testID={full ? 'lab-fullscreen' : undefined}>
        <View style={viewportStyle} accessibilityLabel={simLabel} testID="lab-viewport">
          {location ? (
            <SimView
              key={`${location.indexUrl}#${mount}`}
              lab={lab}
              location={location}
              init={{ locale, theme: dark ? 'dark' : 'light', reducedMotion: ui.reducedMotion, lowPower, params: {}, tasks: lab.taskSpecs, ...(lab.taskSpecs[current] ? { activeTaskId: lab.taskSpecs[current]!.id } : {}) }}
              readyTimeoutMs={lowPower ? app.flags.get('sim.ready_timeout_ms_low') : app.flags.get('sim.ready_timeout_ms')}
              maxStateHz={app.flags.get('sim.max_state_hz')}
              maxErrors={app.flags.get('sim.max_errors')}
              label={simLabel}
              onHost={onHost}
              onEvent={onEvent}
              testID="lab-sim"
            />
          ) : null}
          {phase === 'preparing' || phase === 'loading' || phase === 'slow' ? (
            <View style={[StyleSheet.absoluteFill, styles.loading, { backgroundColor: theme.colors.surfaceSunken }]} testID="lab-loading">
              <View style={styles.dim}>
                <Illustration name={labIllustration(lab)} decorative width={160} height={120} />
              </View>
              {phase === 'preparing' && lab.sizeBytes ? (
                <View style={styles.progress}>
                  <Text variant="caption" numeric align="center">
                    {t('memory_labs:LAB-04.downloading', { a: megabytes(bytes), b: megabytes(lab.sizeBytes) })}
                  </Text>
                  <ProgressBar value={Math.min(1, bytes / lab.sizeBytes)} tone="primary" label={t('memory_labs:LAB-04.downloading.1')} />
                </View>
              ) : phase === 'slow' ? (
                <View style={styles.progress}>
                  <Text variant="body" align="center">
                    {t('memory_labs:LAB-04.slow')}
                  </Text>
                  <View style={styles.row}>
                    <Button
                      size="sm"
                      variant="secondary"
                      label={t('memory_labs:LAB-04.keep_waiting')}
                      onPress={() => {
                        session.current?.keepWaiting();
                        setPhase('loading');
                      }}
                      testID="lab-keep-waiting"
                    />
                    <Button size="sm" variant="ghost" label={t('memory_labs:LAB-04.without')} onPress={() => fallback('failed', 'timeout')} testID="lab-without" />
                  </View>
                </View>
              ) : (
                <Spinner label={t('memory_labs:LAB-04.setting_up')} />
              )}
            </View>
          ) : null}
          {paused ? (
            <Pressable
              style={[StyleSheet.absoluteFill, styles.paused]}
              accessibilityRole="button"
              accessibilityLabel={t('ui:common.dismiss')}
              onPress={() => {
                session.current?.resume();
                setPaused(false);
              }}
            >
              <Icon name="PauseCircle" size={32} color="ink" />
            </Pressable>
          ) : null}
          {lowPower && running ? (
            <View style={styles.badge}>
              <Chip kind="status" tone="sunken" icon="Lightning" label={t('memory_labs:LAB-04.low_power')} onPress={() => setToast(t('memory_labs:LAB-04.low_power_on'))} />
            </View>
          ) : null}
          {!little && location ? (
            <View style={[styles.expand, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card }]}>
              <IconButton icon={full ? 'ArrowsIn' : 'ArrowsOut'} label={full ? t('memory_labs:LAB-04.collapse') : t('memory_labs:LAB-04.expand')} onPress={toggleFull} size={48} testID="lab-expand" />
            </View>
          ) : null}
        </View>

        {full && !panelOpen ? (
          <Pressable
            onPress={() => setPanelOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t('memory_labs:LAB-04.tasks', { done, total })}
            style={[styles.tab, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card }]}
            testID="lab-panel-tab"
          >
            <Icon name="ListChecks" size={24} color="ink" />
            <Text variant="caption" numeric>{`${done}/${total}`}</Text>
          </Pressable>
        ) : null}
        <View style={full ? (panelOpen ? [styles.panel, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card }] : styles.hidden) : styles.gapLarge} testID={full ? 'lab-panel' : undefined}>
          <ScrollView scrollEnabled={full} style={full ? styles.grow : undefined} contentContainerStyle={styles.gapLarge}>
            {full ? <IconButton icon="CaretRight" label={t('ui:common.close')} onPress={() => setPanelOpen(false)} testID="lab-panel-close" /> : null}

            {!little && running ? (
              <View style={styles.strip} accessibilityLiveRegion="polite" testID="lab-readings">
                {readings.slice(0, 4).map((r) => (
                  <Chip key={r.name} kind="status" tone="sunken" label={t('memory_labs:LAB-04.reading_chip', { quantity: r.label?.[locale] ?? r.name, value: formatReading(r.value, r.precision, locale), unit: r.unit })} />
                ))}
                <Button size="sm" variant="secondary" icon="Plus" label={t('memory_labs:LAB-04.record')} onPress={() => session.current?.record(task?.id)} testID="lab-record" />
                <Button size="sm" variant="ghost" label={t('memory_labs:LAB-04.readings_link', { n: rows.length })} onPress={() => setSheet(true)} testID="lab-readings-open" />
              </View>
            ) : null}

            {total > 0 ? (
              <Card testID="lab-tasks">
                <View style={styles.gap}>
                  <View style={styles.row}>
                    <Text variant="heading" numeric style={styles.grow}>
                      {t('memory_labs:LAB-04.tasks', { done, total })}
                    </Text>
                    <Button size="sm" variant="ghost" icon="ChatCircleText" label={t('memory_labs:LAB-04.ask')} onPress={() => router.push({ pathname: '/tutor', params: { context: lab.title[locale] } })} testID="lab-ask" />
                  </View>
                  {lab.taskSpecs.map((s, i) => {
                    const p = tasks.find((x) => x.taskId === s.id);
                    const isCurrent = i === current;
                    const icon = p?.status === 'correct' ? 'CheckCircle' : p?.status === 'skipped' ? 'ArrowRight' : 'Circle';
                    const tone = p?.status === 'correct' ? ('successText' as const) : isCurrent ? ('primary' as const) : ('inkMuted' as const);
                    return (
                      <Pressable
                        key={s.id}
                        onPress={() => {
                          setCurrent(i);
                          session.current?.setActiveTask(s.id);
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isCurrent }}
                        style={styles.taskRow}
                        testID={`lab-task-${i}`}
                      >
                        <Icon name={icon} size={24} color={tone} />
                        <View style={styles.grow}>
                          <Text variant={isCurrent ? 'label' : 'body'}>{s.prompt[locale]}</Text>
                          {isCurrent && p?.status === 'correct' ? (
                            <Text variant="caption" tone="success">
                              {t('memory_labs:LAB-04.right')}
                            </Text>
                          ) : null}
                          {isCurrent && p?.status === 'wrong' ? (
                            <Banner tone="warning" icon="Warning" text={t('memory_labs:LAB-04.not_quite', { quantity: quantityLabel(lab, p.quantity, locale) })} testID="lab-not-quite" />
                          ) : null}
                          {isCurrent && hint ? (
                            <View style={styles.gap}>
                              <Text variant="caption" tone="muted">
                                {t('memory_labs:LAB-04.hint', { task_hint: hint })}
                              </Text>
                              <Button
                                size="sm"
                                variant="ghost"
                                label={t('memory_labs:LAB-04.skip')}
                                onPress={() => {
                                  session.current?.skip(s.id);
                                  const all = session.current?.taskProgress() ?? tasks;
                                  setTasks(all);
                                }}
                                testID="lab-skip"
                              />
                            </View>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </Card>
            ) : null}

            {running && done === 0 && rows.length === 0 && !full ? <BuddyLine text={t('memory_labs:LAB-04.pet_first')} /> : null}
          </ScrollView>
          {full ? primary : null}
        </View>
      </View>

      <Sheet open={menu} onOpenChange={setMenu} title={t('ui:common.moreOptions')} height="40" testID="lab-menu-sheet">
        <View style={styles.gap}>
          <Button
            variant="secondary"
            icon="ArrowCounterClockwise"
            label={t('memory_labs:LAB-04.reset')}
            onPress={() => {
              setMenu(false);
              setConfirmReset(true);
            }}
            testID="lab-reset"
          />
          <Switch
            checked={lowPower}
            onCheckedChange={(on) => {
              setLowPower(on);
              session.current?.setParams({ lowPower: on });
              app.track('sim_low_power_changed', { sim_id: lab.id, orientation: 'portrait', on });
            }}
            label={t('memory_labs:LAB-04.low_power')}
            testID="lab-low-power"
          />
          <Button
            variant="ghost"
            label={t('memory_labs:LAB-04.without')}
            onPress={() => {
              setMenu(false);
              fallback('failed', 'unsupported');
            }}
          />
          <Button
            variant="ghost"
            icon="Flag"
            label={t('memory_labs:LAB-18.report')}
            onPress={() => {
              setMenu(false);
              router.push({ pathname: '/report-content', params: { kind: 'sim', ref: lab.id } });
            }}
          />
        </View>
      </Sheet>

      <Sheet open={sheet} onOpenChange={setSheet} title={t('memory_labs:LAB-06.title')} height="60" testID="LAB-06">
        <ReadingsTable
          lab={lab}
          rows={rows}
          locale={locale}
          onDelete={(id) => {
            session.current?.removeMeasurement(id);
            setRows([...(session.current?.measurements ?? [])]);
            setToast(t('memory_labs:LAB-06.deleted'));
          }}
          onClear={() => setConfirmClear(true)}
        />
      </Sheet>

      <Dialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t('memory_labs:LAB-04.reset')}
        description={t('memory_labs:LAB-04.reset_confirm')}
        confirm={{
          label: t('memory_labs:LAB-04.reset'),
          onPress: () => {
            session.current?.reset();
            app.track('sim_reset', { sim_id: lab.id, orientation: 'portrait', on: lowPower });
            setConfirmReset(false);
          },
        }}
        cancel={{ label: t('ui:common.back'), onPress: () => setConfirmReset(false) }}
      />
      <Dialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t('memory_labs:LAB-06.clear')}
        description={t('memory_labs:LAB-06.clear_confirm')}
        confirm={{
          label: t('memory_labs:LAB-06.clear'),
          onPress: () => {
            session.current?.clearMeasurements();
            setRows([]);
            setConfirmClear(false);
          },
        }}
        cancel={{ label: t('ui:common.back'), onPress: () => setConfirmClear(false) }}
      />
      <Toast open={toast !== null} message={toast ?? ''} onDismiss={() => setToast(null)} />
    </Screen>
  );
}

function quantityLabel(lab: LabEntry, name: string | undefined, locale: 'en' | 'hi'): string {
  if (!name) return '';
  return lab.readings.find((r) => r.name === name)?.label[locale] ?? name;
}

/** LAB-06: the lab notebook. A real table; rows can be deleted; [Clear all] asks first. */
function ReadingsTable({ lab, rows, locale, onDelete, onClear }: { lab: LabEntry; rows: readonly MeasurementPayload[]; locale: 'en' | 'hi'; onDelete: (id: string) => void; onClear: () => void }) {
  const t = useT();
  const theme = useTheme();
  if (rows.length === 0) {
    return (
      <Text variant="body" tone="muted" testID="lab-readings-empty">
        {t('memory_labs:LAB-06.empty')}
      </Text>
    );
  }
  return (
    <View style={styles.gap} accessibilityRole="list">
      {rows.map((r, i) => {
        const taskIndex = r.taskId ? lab.taskSpecs.findIndex((s) => s.id === r.taskId) : -1;
        return (
          <View key={r.id} style={[styles.tableRow, { borderBottomColor: theme.colors.line }]} testID={`lab-reading-${i}`}>
            <Text variant="label" numeric tone="muted">{`${i + 1}`}</Text>
            <View style={styles.grow}>
              <Text variant="label" numeric>
                {`${quantityLabel(lab, r.name, locale)}: ${formatReading(r.value, undefined, locale)} ${r.unit}`}
              </Text>
              {taskIndex >= 0 ? (
                <Text variant="caption" tone="muted">
                  {t('memory_labs:LAB-06.for_task', { n: taskIndex + 1 })}
                </Text>
              ) : null}
            </View>
            <IconButton icon="Trash" label={t('memory_labs:LAB-06.deleted')} onPress={() => onDelete(r.id)} size={40} />
          </View>
        );
      })}
      <Button variant="ghost" label={t('memory_labs:LAB-06.clear')} onPress={onClear} testID="lab-readings-clear" />
    </View>
  );
}

/** LAB-05: the idea without the live lab. Tasks are skipped, never marked wrong. */
function LabFallback({ lab, reason, canRetry, onRetry, onContinue }: { lab: LabEntry; reason: FallbackReason; canRetry: boolean; onRetry: () => void; onContinue: () => void }) {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  // `{fallback_body}` comes from the lesson sim card that uses this lab, when one is on the device.
  const lesson = useMemo(() => labLessonText(app, lab.id), [app, lab.id, locale]);
  return (
    <Screen
      testID="LAB-05"
      footer={
        <View style={styles.gap}>
          <Button label={t('memory_labs:LAB-05.continue')} fullWidth onPress={onContinue} testID="lab-fallback-continue" />
          {canRetry ? <Button variant="secondary" label={t('memory_labs:LAB-05.try_again')} fullWidth onPress={onRetry} testID="lab-fallback-retry" /> : null}
        </View>
      }
    >
      <View style={styles.top}>
        <IconButton icon="X" label={t('ui:common.close')} onPress={onContinue} />
        <Text variant="title" heading style={styles.grow}>
          {lab.title[locale]}
        </Text>
        <Chip kind="status" tone={reason === 'offline' ? 'warning' : 'sunken'} icon={reason === 'offline' ? 'WifiSlash' : 'Warning'} label={reason === 'offline' ? t('memory_labs:LAB-05.reason_offline') : t('memory_labs:LAB-05.reason_failed')} />
      </View>
      <BuddyLine text={reason === 'offline' ? t('memory_labs:LAB-05.pet_offline') : t('memory_labs:LAB-05.pet_failed')} />
      <Card>
        <View style={[styles.gap, styles.center]}>
          <Illustration name={labIllustration(lab)} decorative width={240} height={180} />
          {lesson?.fallbackBody ? (
            <Text variant="body" testID="lab-fallback-body">
              {lesson.fallbackBody}
            </Text>
          ) : null}
          <Text variant="heading">{t('memory_labs:LAB-05.see')}</Text>
          {lab.taskSpecs.map((s, i) => (
            <View key={s.id} style={styles.taskRow}>
              <Text variant="label" numeric tone="muted">{`${i + 1}.`}</Text>
              <Text variant="body" style={styles.grow}>
                {s.prompt[locale]}
              </Text>
            </View>
          ))}
        </View>
      </Card>
      <Text variant="caption" tone="muted">
        {t('memory_labs:LAB-05.skipped_note')}
      </Text>
      {reason === 'offline' ? (
        <Text variant="caption" tone="muted">
          {t('memory_labs:LAB-05.download_later')}
        </Text>
      ) : null}
    </Screen>
  );
}

/** LAB-07: what was done, the debrief line and what's next. */
function LabComplete({ lab, done, skipped, total, readings, ms }: { lab: LabEntry; done: number; skipped: number; total: number; readings: number; ms: number }) {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const next = nextLab(LABS, lab.id);
  const lesson = useMemo(() => labLessonText(app, lab.id), [app, lab.id, locale]);
  const explored = skipped > 0;
  return (
    <Screen testID="LAB-07" footer={<Button label={t('memory_labs:LAB-07.done')} fullWidth onPress={() => router.replace('/labs' as Href)} testID="lab-done" />}>
      <View style={[styles.center, styles.gap]}>
        <Illustration name={labIllustration(lab)} decorative width={200} height={150} />
        <Text variant="display" heading align="center" testID="lab-complete-title">
          {explored ? t('memory_labs:LAB-07.explored_title') : t('memory_labs:LAB-07.title')}
        </Text>
      </View>
      <View style={styles.row}>
        <StatTile style={styles.grow} icon="CheckCircle" value={`${done}/${total}`} label={t('memory_labs:LAB-07.tasks')} testID="lab-complete-tasks" />
        <StatTile style={styles.grow} icon="Timer" value={clock(ms)} label={t('memory_labs:LAB-07.time')} />
      </View>
      {explored ? (
        <View style={styles.center}>
          <Text variant="label" tone="muted" numeric align="center" testID="lab-complete-skipped">
            {t('memory_labs:LAB-07.skipped', { n: skipped })}
          </Text>
          <Text variant="caption" tone="muted" align="center">
            {t('memory_labs:LAB-05.skipped_note')}
          </Text>
        </View>
      ) : null}
      {lesson?.debrief ? (
        <Card testID="lab-debrief">
          <Text variant="body">{lesson.debrief}</Text>
        </Card>
      ) : null}
      {readings > 0 ? (
        <Text variant="body" align="center">
          {t('memory_labs:LAB-07.readings', { n: readings })}
        </Text>
      ) : null}
      <BuddyLine text={t('memory_labs:LAB-07.pet')} />
      <View style={styles.gap}>
        <Button variant="secondary" icon="ChatCircleText" label={t('memory_labs:LAB-07.tutor')} onPress={() => router.push({ pathname: '/tutor', params: { context: lab.title[locale] } })} />
        {next ? <Button variant="ghost" icon="Flask" label={t('memory_labs:LAB-07.next_lab', { next_lab_title: next.title[locale] })} onPress={() => router.replace({ pathname: '/lab/[id]', params: { id: next.id } })} testID="lab-next-lab" /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  gap: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  center: { alignItems: 'center' },
  viewport: { width: '100%', overflow: 'hidden' },
  viewportFull: { flex: 1, height: '100%', overflow: 'hidden' },
  stage: { flexDirection: 'row', gap: 8 },
  gapLarge: { gap: 16 },
  panel: { width: PANEL_WIDTH, padding: 12, gap: 12 },
  tab: { width: PANEL_TAB, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 12 },
  hidden: { display: 'none' },
  expand: { position: 'absolute', top: 8, right: 8, opacity: 0.9 },
  loading: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16 },
  dim: { opacity: 0.4 },
  progress: { alignSelf: 'stretch', gap: 8, alignItems: 'center' },
  paused: { alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 8, left: 8 },
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  taskRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', minHeight: 44, paddingVertical: 4 },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 6 },
});
