import { Button, Card, Dialog, IconButton, Illustration, Sheet, StatTile, Text, useTheme } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { LABS, labIllustration } from '../../../src/content/labs';
import { useApp, useT, useUiState } from '../../../src/services/context';
import { labProgress, megabytes, simCache } from '../../../src/services/labs';
import { BuddyLine } from '../../../src/ui/Onboarding';
import { Screen } from '../../../src/ui/Screen';

const PREVIEW_TASKS = 3;

/**
 * LAB-03, a lab before launch: what it is, how big, what you'll do. [Start lab] opens LAB-04.
 * Offline and not downloaded, the button becomes the explainer (LAB-05). [Download for offline]
 * pins it for Pro; free students get the lab cached after its first run anyway (PRD §11.1).
 */
export default function LabDetail() {
  const app = useApp();
  const t = useT();
  const theme = useTheme();
  const locale = useUiState((s) => s.locale);
  const { id } = useLocalSearchParams<{ id: string }>();
  const lab = LABS.find((l) => l.id === id);
  const cache = useMemo(() => simCache(app), [app]);
  const [info, setInfo] = useState(false);
  const [dataAsk, setDataAsk] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [cachedTick, setCachedTick] = useState(0);
  const progress = useQuery({ queryKey: ['smriti', 'lab-progress', id], queryFn: () => labProgress(app, id ?? '') });
  const online = app.deps.network.isOnline();
  const little = app.isLittleLearner();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cached = useMemo(() => (lab ? cache.isCached(lab) : false), [cache, lab, cachedTick]);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/labs' as Href));

  useEffect(() => {
    if (lab) app.track('lab_opened', { lab_id: lab.id, kind: 'sim', entry: 'hub' });
  }, [app, lab]);

  if (!lab) {
    return (
      <Screen testID="LAB-03-missing" footer={<Button variant="secondary" label={t('ui:common.back')} onPress={back} fullWidth />}>
        <Illustration name="ui-offline" decorative width={200} height={150} />
      </Screen>
    );
  }

  const runnable = cached || (online && cache.configured());
  const play = () =>
    runnable ? router.push({ pathname: '/lab/[id]/play', params: { id: lab.id } }) : router.push({ pathname: '/lab/[id]/play', params: { id: lab.id, fallback: online ? 'unsupported' : 'offline' } });
  // On mobile data, a lab bigger than `lab.confirm_download_mb` asks first (LAB-03 data_confirm).
  const confirmMb = app.flags.get('lab.confirm_download_mb');
  const start = () => {
    const big = (lab.sizeBytes ?? 0) > confirmMb * 1024 * 1024;
    if (runnable && !cached && big && app.deps.connection?.isCellular()) setDataAsk(true);
    else play();
  };
  const download = async () => {
    if (!app.isPro()) {
      router.push({ pathname: '/paywall', params: { from: 'offline_download' } });
      return;
    }
    setDownloading(true);
    await cache.prepare(lab, online);
    setDownloading(false);
    setCachedTick((n) => n + 1);
  };
  const size = megabytes(lab.sizeBytes);
  const shown = lab.taskSpecs.slice(0, PREVIEW_TASKS);
  const more = lab.taskSpecs.length - shown.length;
  const metaSentence = `${t('memory_labs:LAB-03.tasks')} ${lab.tasks}, ${cached ? t('memory_labs:LAB-03.downloaded') : `${t('memory_labs:LAB-03.size')} ${size} MB`}`;

  return (
    <Screen
      testID="LAB-03"
      footer={
        <View style={styles.gap}>
          <Button label={runnable ? t('memory_labs:LAB-03.start') : t('memory_labs:LAB-03.see_explainer')} icon={runnable ? 'Play' : 'BookOpen'} fullWidth onPress={start} testID="lab-start" />
          {!little && !cached && cache.configured() && app.deps.simFiles ? (
            <Button variant="secondary" icon="DownloadSimple" label={t('memory_labs:LAB-03.download')} fullWidth loading={downloading} disabled={!online} onPress={() => void download()} testID="lab-download" />
          ) : null}
        </View>
      }
    >
      <View style={[styles.hero, { backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.cardLarge }]}>
        <View style={styles.heroBar}>
          <IconButton icon="CaretLeft" label={t('ui:common.back')} onPress={back} variant="filled" />
          <IconButton icon="Info" label={t('memory_labs:LAB-18.title')} onPress={() => setInfo(true)} variant="filled" testID="lab-info" />
        </View>
        <Illustration name={labIllustration(lab)} decorative width={240} height={180} />
      </View>
      <Text variant="title" heading testID="lab-title">
        {lab.title[locale]}
      </Text>
      {!little ? (
        <View style={styles.tiles} accessible accessibilityLabel={metaSentence}>
          <StatTile style={styles.tile} icon="CheckCircle" value={progress.data ? `${progress.data.done}/${lab.tasks}` : String(lab.tasks)} label={t('memory_labs:LAB-03.tasks')} />
          <StatTile style={styles.tile} icon={cached ? 'CloudCheck' : 'DownloadSimple'} value={cached ? t('memory_labs:LAB-03.downloaded') : `${size} MB`} label={t('memory_labs:LAB-03.size')} testID="lab-size" />
        </View>
      ) : null}
      {shown.length ? (
        <Card>
          <View style={styles.gap}>
            <Text variant="heading">{t('memory_labs:LAB-03.what_do')}</Text>
            {shown.map((task, i) => (
              <View key={task.id} style={styles.taskRow}>
                <Text variant="label" numeric tone="muted">{`${i + 1}.`}</Text>
                <Text variant="body" style={styles.grow}>
                  {task.prompt[locale]}
                </Text>
              </View>
            ))}
            {more > 0 ? (
              <Text variant="caption" tone="muted">
                {t('memory_labs:LAB-03.more', { n: more })}
              </Text>
            ) : null}
          </View>
        </Card>
      ) : null}
      {!runnable ? (
        <Text variant="caption" tone="muted" testID="lab-needs-net">
          {online ? t('memory_labs:LAB-05.reason_failed') : t('memory_labs:LAB-03.needs_net', { s: size })}
        </Text>
      ) : null}
      {lab.attribution ? (
        <Text variant="caption" tone="muted">
          {lab.attribution}
        </Text>
      ) : null}
      <BuddyLine text={t('memory_labs:LAB-04.pet_first')} />
      <Dialog
        open={dataAsk}
        onOpenChange={(o) => (o ? undefined : setDataAsk(false))}
        title={t('memory_labs:LAB-03.data_confirm', { s: size })}
        confirm={{
          label: t('memory_labs:LAB-03.data_yes'),
          onPress: () => {
            setDataAsk(false);
            play();
          },
        }}
        cancel={{ label: t('memory_labs:LAB-03.data_no'), onPress: () => setDataAsk(false) }}
        testID="lab-data-confirm"
      />
      <Sheet open={info} onOpenChange={setInfo} title={t('memory_labs:LAB-18.title')} height="40" testID="LAB-18">
        <View style={styles.gap}>
          <InfoRow label={t('memory_labs:LAB-18.made_by')} value={lab.attribution ?? app.appName()} />
          <InfoRow label={t('memory_labs:LAB-18.licence')} value={lab.licence} />
          <InfoRow label={t('memory_labs:LAB-18.version')} value={lab.version} />
          <InfoRow label={t('memory_labs:LAB-18.size')} value={`${size} MB`} />
          <InfoRow label={t('memory_labs:LAB-18.offline')} value={cached ? t('memory_labs:LAB-18.yes') : t('memory_labs:LAB-18.no')} />
          {cached ? (
            <Button
              variant="ghost"
              icon="Trash"
              label={t('memory_labs:LAB-18.remove')}
              onPress={() => {
                cache.remove(lab);
                setCachedTick((n) => n + 1);
              }}
              testID="lab-remove"
            />
          ) : null}
        </View>
      </Sheet>
    </Screen>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <Text variant="label" numeric>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 10 },
  grow: { flex: 1 },
  hero: { alignItems: 'center', paddingBottom: 16, paddingTop: 8, paddingHorizontal: 8, gap: 4 },
  heroBar: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch' },
  tiles: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1 },
  taskRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
});
