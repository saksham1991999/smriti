import { useAppStore } from '@smriti/app-core/react';
import { Banner, Button, Card, Icon, Spinner, Text, useTheme } from '@smriti/ui-native';
import { Redirect, router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Linking, StyleSheet, View } from 'react-native';

import type { Offer } from '../src/billing/types';
import type { PhotoResult, PickedPhoto } from '../src/platform/photos';
import { useApp, useT, useUiState } from '../src/services/context';
import { unavailablePhotoDoubts, type PhotoDoubtResult } from '../src/services/tutor';
import { withPrices } from '../src/ui/FreeLimitSheet';
import { BackHeader, Screen } from '../src/ui/Screen';

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

type Step = { kind: 'permission' } | { kind: 'denied' } | { kind: 'crop'; photo: PickedPhoto } | { kind: 'reading'; photo: PickedPhoto } | { kind: 'result'; photo: PickedPhoto; result: PhotoDoubtResult };

/**
 * Photo doubts: AI-07 teaser for free students (a Pro tool), then AI-12 camera permission, AI-16
 * capture (the system camera through `PhotoSource`), AI-17 crop (the picker's own crop) and AI-18
 * reading. Not offered to under-13s. Only the photo the student takes is sent, without EXIF.
 */
export default function PhotoDoubt() {
  const app = useApp();
  const t = useT();
  const theme = useTheme();
  const plan = useAppStore((s) => s.entitlement?.plan ?? 'free');
  const pricing = useUiState((s) => s.config.pricing);
  const [step, setStep] = useState<Step>({ kind: 'permission' });
  const [offer, setOffer] = useState<Offer | null>(null);
  const child = app.isLittleLearner() || app.ageBand() === '10_12' || app.ageBand() === 'u10';
  const pro = plan === 'pro';
  const close = () => (router.canGoBack() ? router.back() : router.replace('/tutor' as Href));

  useEffect(() => {
    if (pro || child) return;
    void app.billing
      .offers()
      .then((o) => setOffer(o[0] ?? null))
      .catch(() => setOffer(null));
  }, [app, pro, child]);

  const take = async (from: 'camera' | 'gallery') => {
    const src = app.deps.photos;
    if (!src) return;
    let r: PhotoResult;
    try {
      r = from === 'camera' ? await src.takePhoto() : await src.choosePhoto();
    } catch {
      r = { status: 'cancelled' };
    }
    app.track('photo_doubt_step', { step: r.status === 'denied' ? 'permission_denied' : from === 'camera' ? 'capture' : 'gallery' });
    if (r.status === 'denied') setStep({ kind: 'denied' });
    else if (r.status === 'picked') setStep({ kind: 'crop', photo: r.photo });
  };
  const use = async (photo: PickedPhoto) => {
    setStep({ kind: 'reading', photo });
    const result = await unavailablePhotoDoubts.read(photo).catch((): PhotoDoubtResult => ({ status: 'error' }));
    app.track('photo_doubt_step', { step: result.status === 'read' ? 'read_ok' : 'read_failed', fail_reason: result.status });
    setStep({ kind: 'result', photo, result });
  };

  // Under-13s never see the entry; a stray link goes back to the chat.
  if (child) return <Redirect href={'/tutor' as Href} />;

  if (!pro) {
    const intro = rupees(offer?.introPricePaise ?? pricing.intro_paise);
    const monthly = rupees(offer?.pricePaise ?? pricing.monthly_paise);
    return (
      <Screen
        testID="AI-07"
        footer={
          <View style={styles.gap}>
            <Button label={t('tutor_social:AI-07.primary')} onPress={() => router.push({ pathname: '/paywall', params: { from: 'photo_doubt' } })} testID="teaser-pro" />
            <Button variant="ghost" label={t('tutor_social:AI-07.secondary')} onPress={close} testID="teaser-not-now" />
          </View>
        }
      >
        <BackHeader title={t('tutor_social:AI-07.photo_title')} backLabel={t('ui:common.close')} onBack={close} />
        <Card tone="tint">
          <View style={styles.gap}>
            <Icon name="Sparkle" color="primary" />
            <Text variant="title" heading>
              {t('tutor_social:AI-07.photo_title')}
            </Text>
            <Text variant="body">{t('tutor_social:AI-07.photo_body')}</Text>
          </View>
        </Card>
        {offer?.introEligible ? (
          <Text variant="caption" tone="muted" align="center" testID="teaser-price">
            {withPrices(t('tutor_social:AI-07.price_line'), intro, monthly)}
          </Text>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen testID="AI-16">
      <BackHeader title={t('tutor_social:AI-07.photo_title')} backLabel={t('ui:common.close')} onBack={close} />
      {step.kind === 'permission' ? (
        <View style={styles.gap} testID="AI-12">
          <Text variant="title" heading>
            {t('tutor_social:AI-12.camera_title')}
          </Text>
          <Text variant="body">{t('tutor_social:AI-12.camera_body')}</Text>
          <Text variant="caption" tone="muted">
            {t('tutor_social:AI-16.hint')}
          </Text>
          <Button label={t('tutor_social:AI-12.allow_camera')} onPress={() => void take('camera')} testID="photo-camera" />
          <Button variant="secondary" label={t('tutor_social:AI-12.camera_fallback')} onPress={() => void take('gallery')} testID="photo-gallery" />
          <Button variant="ghost" label={t('tutor_social:AI-12.not_now')} onPress={close} />
        </View>
      ) : null}
      {step.kind === 'denied' ? (
        <View style={styles.gap} testID="photo-denied">
          <Text variant="title" heading>
            {t('tutor_social:AI-12.camera_denied_title', { brand: app.appName() })}
          </Text>
          <Text variant="body">{t('tutor_social:AI-12.denied_body')}</Text>
          <Button label={t('tutor_social:AI-12.open_settings')} onPress={() => void Linking.openSettings()} />
          <Button variant="secondary" label={t('tutor_social:AI-12.camera_fallback')} onPress={() => void take('gallery')} />
        </View>
      ) : null}
      {step.kind === 'crop' || step.kind === 'reading' || step.kind === 'result' ? (
        <View style={styles.gap} testID={step.kind === 'crop' ? 'AI-17' : 'AI-18'}>
          <Image source={{ uri: step.photo.uri }} accessibilityLabel={t('tutor_social:AI-18.title')} resizeMode="contain" style={[styles.photo, { aspectRatio: step.photo.width / Math.max(1, step.photo.height), borderRadius: theme.radius.card, backgroundColor: theme.colors.surfaceSunken }]} />
          {step.kind === 'crop' ? (
            <>
              <Text variant="caption" tone="muted" align="center">
                {t('tutor_social:AI-17.hint')}
              </Text>
              <View style={styles.row}>
                <Button variant="secondary" label={t('tutor_social:AI-17.retake')} onPress={() => void take('camera')} style={styles.grow} />
                <Button label={t('tutor_social:AI-17.use_photo')} onPress={() => void use(step.photo)} style={styles.grow} testID="photo-use" />
              </View>
            </>
          ) : null}
          {step.kind === 'reading' ? <Spinner label={t('tutor_social:AI-18.reading')} /> : null}
          {step.kind === 'result' && step.result.status !== 'read' ? (
            <>
              <Banner tone="warning" icon="Warning" text={t('tutor_social:AI-02.server_error')} testID="photo-unavailable" />
              <Button variant="secondary" label={t('tutor_social:AI-18.retake')} onPress={() => void take('camera')} />
            </>
          ) : null}
          {step.kind === 'result' && step.result.status === 'read' ? (
            <>
              <Text variant="heading">{t('tutor_social:AI-18.confirm')}</Text>
              <Text variant="body">{step.result.questionText}</Text>
              <Button label={t('tutor_social:AI-18.solve')} onPress={() => router.replace('/tutor' as Href)} />
            </>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 12 },
  row: { flexDirection: 'row', gap: 12 },
  grow: { flex: 1 },
  photo: { width: '100%' },
});
