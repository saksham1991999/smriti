import { ratingFromLabel, type IntervalPreview, type ReviewRating, type SrsCardRow } from '@smriti/app-core';
import { useAppStore } from '@smriti/app-core/react';
import { RichText } from '@smriti/lesson-player-native';
import type { Confidence as UiConfidence, Rating } from '@smriti/tokens/ui';
import { Button, ConfidenceRow, IconButton, PetView, RatingButtons, SegmentedProgress, Spinner, StatTile, Text, Toast, useTheme } from '@smriti/ui-native';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { useApp, useT } from '../src/services/context';
import { clock } from '../src/services/drill';
import type { Confidence } from '../src/services/mocks';
import { cardFace, Reviews, type CardFace } from '../src/services/reviews';
import { QuestionHost } from '../src/ui/QuestionHost';
import { Screen } from '../src/ui/Screen';

const FROM_UI: Record<UiConfidence, Confidence> = { sure: 'sure', half: 'fifty_fifty', guess: 'guess' };
const TO_UI: Record<Confidence, UiConfidence> = { sure: 'sure', fifty_fifty: 'half', guess: 'guess' };
const HALF_PET = 0.5;

interface Item {
  row: SrsCardRow;
  face: CardFace;
}

/**
 * The last rating, held for Undo (flow §5: one step). It is written to the outbox when the next
 * card is rated, when the session ends or is left, or when the app goes to the background.
 */
interface Pending {
  item: Item;
  index: number;
  rating: ReviewRating;
  confidence: Confidence | null;
  ms: number;
  at: number;
  remembered: number;
  sureWrong: number;
}

/** `review_undone.card_type` from the card ref prefix (no card text). */
function cardType(ref: string): string {
  return ref.startsWith('q:') ? 'question' : ref.startsWith('d:') || ref.startsWith('u:') ? 'own' : 'content';
}

/**
 * MEM-03, a review session, and MEM-04, its end. Front, [Show answer], optional "How sure?",
 * then Again / Hard / Good / Easy with each button's next interval from FSRS on the device.
 * Cards whose content isn't on the device are skipped and counted (MEM-03 "needs internet").
 * `?kind=rescue` is the 2-minute rescue (R23).
 */
export default function Review() {
  const app = useApp();
  const t = useT();
  const theme = useTheme();
  const queries = useQueryClient();
  const params = useLocalSearchParams<{ kind?: string; topic?: string }>();
  const rescue = params.kind === 'rescue';
  const reviews = useMemo(() => new Reviews(app), [app]);
  const streak = useAppStore((s) => s.streak);
  const pet = useAppStore((s) => s.pet);
  const [items, setItems] = useState<Item[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [remembered, setRemembered] = useState(0);
  const [sureWrong, setSureWrong] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const shownAt = useRef(app.now());
  const startedAt = useRef(app.now());

  useEffect(() => {
    let alive = true;
    void (async () => {
      const rows = await reviews.session(rescue ? 'rescue' : 'normal', params.topic);
      const out: Item[] = [];
      let missing = 0;
      for (const row of rows) {
        const face = await cardFace(app, row);
        if (face) out.push({ row, face });
        else missing++;
      }
      if (!alive) return;
      setItems(out);
      setSkipped(missing);
      if (out.length === 0) setDone(true);
      shownAt.current = app.now();
    })();
    return () => {
      alive = false;
    };
  }, [app, reviews, rescue, params.topic]);

  const item = items?.[index] ?? null;
  const previews = useMemo<IntervalPreview[]>(() => (item ? reviews.preview(item.row) : []), [item, reviews]);
  const fmt = (p: IntervalPreview | undefined) => {
    if (!p) return '';
    const { value, unit } = p.display;
    if (unit === 'min' || unit === 'h') return t('memory_labs:MEM-03.interval_min', { n: unit === 'h' ? value * 60 : value });
    if (unit === 'd') return t('memory_labs:MEM-03.interval_day', { n: value });
    return t('memory_labs:MEM-03.interval_month', { n: unit === 'y' ? value * 12 : value });
  };
  const intervals: Record<Rating, string> = { again: fmt(previews[0]), hard: fmt(previews[1]), good: fmt(previews[2]), easy: fmt(previews[3]) };

  /** Writes the held rating (schedule and `review_rated` together); safe to call twice. */
  const commit = useCallback(async () => {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    setPending(null);
    await reviews.rate(p.item.row, p.rating, p.confidence, p.ms, p.at);
  }, [reviews]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') void commit();
    });
    return () => {
      sub.remove();
      void commit();
    };
  }, [commit]);

  const finish = async () => {
    await commit();
    setDone(true);
    if (rescue && items) await reviews.finishRescue(items.length, app.now() - startedAt.current);
    void queries.invalidateQueries({ queryKey: ['smriti', 'memory'] });
  };

  const rate = async (r: Rating) => {
    if (!item || busy) return;
    setBusy(true);
    const rating = ratingFromLabel(r);
    await commit();
    const hold: Pending = { item, index, rating, confidence, ms: app.now() - shownAt.current, at: app.now(), remembered, sureWrong };
    pendingRef.current = hold;
    setPending(hold);
    if (rating > 1) setRemembered((n) => n + 1);
    else if (confidence === 'sure') setSureWrong((n) => n + 1);
    setFlipped(false);
    setConfidence(null);
    shownAt.current = app.now();
    setBusy(false);
    if (items && index + 1 >= items.length) void finish();
    else setIndex((i) => i + 1);
  };

  /** MEM-03 Undo: drops the held rating and shows that card's answer again. */
  const undo = () => {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    setPending(null);
    setIndex(p.index);
    setRemembered(p.remembered);
    setSureWrong(p.sureWrong);
    setConfidence(p.confidence);
    setFlipped(true);
    shownAt.current = app.now() - p.ms;
    app.track('review_undone', { card_type: cardType(p.item.row.card_ref) });
  };

  const leave = () => {
    void commit();
    const left = (items?.length ?? 0) - index;
    if (!done && left > 0 && index > 0) setToast(t('memory_labs:MEM-03.exit_toast', { n: left }));
    void queries.invalidateQueries({ queryKey: ['smriti', 'memory'] });
    if (router.canGoBack()) router.back();
    else router.replace('/memory' as Href);
  };

  if (!items) return <Screen testID="MEM-03-loading">{<Spinner label={t('memory_labs:MEM-01.title')} />}</Screen>;

  if (done) {
    const total = items.length;
    return (
      <Screen testID="MEM-04" footer={<Button label={t('memory_labs:MEM-04.done')} onPress={() => router.replace('/memory' as Href)} testID="review-done" />}>
        <View style={styles.center}>
          {pet ? <PetView species={pet.species} mood="proud" size={140} alt={pet.name} /> : null}
          <Text variant="display" heading align="center">
            {t('memory_labs:MEM-04.title')}
          </Text>
        </View>
        <View style={styles.tiles}>
          <StatTile style={styles.tile} icon="Brain" value={`${remembered}/${total}`} label={t('memory_labs:MEM-04.remembered')} testID="review-remembered" />
          <StatTile style={styles.tile} icon="Timer" value={clock(app.now() - startedAt.current)} label={t('memory_labs:MEM-04.time')} />
        </View>
        {streak?.today_qualified ? (
          <Text variant="body" align="center">
            {t('memory_labs:MEM-04.plant')}
          </Text>
        ) : null}
        {skipped > 0 ? (
          <Text variant="caption" tone="muted" align="center" testID="review-skipped">
            {t('memory_labs:MEM-04.needs_net', { s: skipped })}
          </Text>
        ) : null}
        {sureWrong > 0 ? (
          <Text variant="caption" tone="muted" align="center">
            {t('memory_labs:MEM-04.sure_wrong', { w: sureWrong })}
          </Text>
        ) : null}
        {total === 0 && skipped === 0 ? (
          <Text variant="heading" align="center">
            {t('memory_labs:MEM-01.today_none')}
          </Text>
        ) : null}
      </Screen>
    );
  }

  const face = item!.face;
  const undoButton = pending ? (
    <View style={styles.undoRow}>
      <Button size="sm" variant="ghost" icon="ArrowUUpLeft" label={t('memory_labs:MEM-03.undo')} onPress={undo} testID="review-undo" />
    </View>
  ) : null;
  const footer = flipped ? (
    <View>
      {undoButton}
      <RatingButtons intervals={intervals} onRate={(r) => void rate(r)} disabled={busy} testID="review-rate" />
    </View>
  ) : (
    <View>
      {undoButton}
      <Button label={t('memory_labs:MEM-03.show_answer')} onPress={() => setFlipped(true)} testID="review-show" />
    </View>
  );

  return (
    <Screen testID="MEM-03" footer={footer}>
      <View style={styles.top}>
        <IconButton icon="X" label={t('ui:common.close')} onPress={leave} testID="review-close" />
        <View style={styles.grow}>
          <SegmentedProgress total={items.length} done={index} current={index} tone="primary" label={`${index + 1} / ${items.length}`} />
        </View>
        <Text variant="label" numeric>{`${index + 1}/${items.length}`}</Text>
      </View>
      {rescue ? (
        <Text variant="caption" tone="muted">
          {t('memory_labs:MEM-03.rescue_header', { k: items.length })}
        </Text>
      ) : null}
      <QuestionHost>
        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.cardLarge }]} testID="review-card">
          <RichText text={face.front} variant="heading" testID="review-front" />
          {flipped ? (
            <View style={[styles.back, { borderTopColor: theme.colors.line }]}>
              {face.back ? <RichText text={face.back} testID="review-back" /> : null}
            </View>
          ) : null}
        </View>
      </QuestionHost>
      {!flipped && reviews.config ? <ConfidenceRow value={confidence ? TO_UI[confidence] : null} onChange={(c) => setConfidence(c ? FROM_UI[c] : null)} testID="review-confidence" /> : null}
      {index / Math.max(1, items.length) >= HALF_PET && index > 0 && !flipped ? (
        <Text variant="caption" tone="muted" align="center">
          {t('memory_labs:MEM-03.pet_half')}
        </Text>
      ) : null}
      <Toast open={toast !== null} message={toast ?? ''} onDismiss={() => setToast(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  center: { alignItems: 'center', gap: 8 },
  tiles: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1 },
  card: { padding: 20, gap: 16, minHeight: 220, justifyContent: 'center' },
  back: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16 },
  undoRow: { flexDirection: 'row', justifyContent: 'flex-start', marginBottom: 4 },
});
