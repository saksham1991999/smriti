import { useAppStore } from '@smriti/app-core/react';
import { Button, Dialog, Icon, Illustration, PriceBlock, Spinner, Text, TrialTimeline } from '@smriti/ui-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { FakeBilling } from '../src/billing/fake';
import type { Offer } from '../src/billing/types';
import { useApp, useT, useUiState } from '../src/services/context';
import { BuddyLine } from '../src/ui/Onboarding';
import { Screen } from '../src/ui/Screen';

const BENEFITS = ['benefit_deep_dives', 'benefit_practice', 'benefit_mocks', 'benefit_tutor', 'benefit_freezes'] as const;

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * PAY-01 (paywall), PAY-08 (confirming with the server) and PAY-09 (Pro is on). Pro is unlocked
 * only when `/v1/sync/state` says so (app.purchasePro). Guests sign in first (AUTH-02).
 */
export default function Paywall() {
  const app = useApp();
  const t = useT();
  const params = useLocalSearchParams<{ from?: string }>();
  const purchase = useUiState((s) => s.purchase);
  const pricing = useUiState((s) => s.config.pricing);
  const locale = useUiState((s) => s.locale);
  const signedIn = useAppStore((s) => s.session.status === 'signed_in');
  const pet = useAppStore((s) => s.pet);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [fakeAsk, setFakeAsk] = useState(false);
  const online = app.deps.network.isOnline();

  useEffect(() => {
    app.ui.setState({ purchase: { status: 'idle' } });
    void app.billing
      .offers()
      .then((o) => setOffer(o[0] ?? null))
      .catch(() => setOffer(null));
  }, [app]);

  const eligible = offer?.introEligible ?? true;
  const intro = rupees(offer?.introPricePaise ?? pricing.intro_paise);
  const monthly = rupees(offer?.pricePaise ?? pricing.monthly_paise);
  const now = new Date(app.now());
  const renew = new Date(now);
  renew.setMonth(renew.getMonth() + 1);
  const remind = new Date(renew.getTime() - (app.flags.get('billing.trial_reminder_days_before') ?? 2) * 86_400_000);
  const fmt = (d: Date) => d.toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short' });
  const close = () => (router.canGoBack() ? router.back() : router.replace('/learn' as Href));

  const buy = async () => {
    if (!signedIn) {
      router.replace({ pathname: '/sign-in', params: { mode: 'hard', reason: 'start_trial', then: 'paywall' } });
      return;
    }
    if (app.billing instanceof FakeBilling) setFakeAsk(true);
    else await app.purchasePro();
  };
  const fakePay = async (approve: boolean) => {
    setFakeAsk(false);
    if (app.billing instanceof FakeBilling) app.billing.nextResult = approve ? 'purchase' : 'fail';
    await app.purchasePro();
    if (app.billing instanceof FakeBilling) app.billing.nextResult = 'purchase';
  };

  if (purchase.status === 'done') {
    return (
      <Screen testID="PAY-09" footer={<Button label={t('me_money:PAY-09.continue')} onPress={() => router.replace('/learn' as Href)} fullWidth testID="pro-continue" />}>
        <View style={styles.center}>
          <Illustration name="scene-paywall" decorative width={220} height={170} />
          <Text variant="display" heading align="center" testID="pro-on">
            {t('me_money:PAY-09.title')}
          </Text>
          <Text variant="body" tone="muted" align="center">
            {eligible ? t('me_money:PAY-09.terms_intro', { date: fmt(renew), reminder_date: fmt(remind) }) : t('me_money:PAY-09.terms_regular', { date: fmt(renew) })}
          </Text>
          <Text variant="caption" tone="muted" align="center">
            {t('me_money:PAY-09.cancel_link')}
          </Text>
        </View>
        {pet ? <BuddyLine text={t('me_money:PAY-09.pet_line')} /> : null}
      </Screen>
    );
  }

  if (purchase.status === 'confirming' || purchase.status === 'pending') {
    return (
      <Screen
        testID="PAY-08"
        footer={purchase.status === 'pending' ? <Button variant="secondary" label={t('me_money:PAY-08.check_again')} onPress={() => void app.purchasePro()} fullWidth testID="pay-check-again" /> : undefined}
      >
        <View style={styles.center}>
          <Spinner size={32} label={t('me_money:PAY-08.title')} />
          <Text variant="title" heading align="center">
            {t('me_money:PAY-08.title')}
          </Text>
        </View>
        {(['step_1', eligible ? 'step_2' : 'step_2_not_eligible', 'step_3'] as const).map((k, i) => (
          <View key={k} style={styles.step}>
            <Icon name={i < 2 ? 'CheckCircle' : 'Clock'} weight={i < 2 ? 'fill' : 'bold'} color={i < 2 ? 'success' : 'inkMuted'} />
            <Text variant="body">{t(`me_money:PAY-08.${k}`)}</Text>
          </View>
        ))}
        {pet ? <BuddyLine text={t('me_money:PAY-08.pet_line')} /> : null}
      </Screen>
    );
  }

  return (
    <Screen
      testID="PAY-01"
      footer={
        <>
          <Button label={eligible ? t('me_money:PAY-01.cta_eligible') : t('me_money:PAY-01.cta_not_eligible')} disabled={!online} onPress={() => void buy()} fullWidth testID="pay-cta" />
          {!signedIn ? (
            <Text variant="caption" tone="muted" align="center">
              {t('me_money:PAY-01.guest_hint_under_cta')}
            </Text>
          ) : null}
          <Button variant="ghost" size="sm" label={t('me_money:PAY-01.maybe_later')} onPress={close} fullWidth testID="pay-later" />
        </>
      }
    >
      <View style={styles.center}>
        <Illustration name="cat-price-tag" decorative width={180} height={140} />
        <Text variant="display" heading align="center">
          {eligible ? t('me_money:PAY-01.headline_eligible') : t('me_money:PAY-01.headline_not_eligible')}
        </Text>
        <Text variant="body" tone="muted" align="center">
          {eligible ? t('me_money:PAY-01.sub_eligible') : t('me_money:PAY-01.sub_not_eligible')}
        </Text>
      </View>
      {params.from === 'preview' && pet ? <BuddyLine text={t('me_money:PAY-01.pet_deep_dive_lock')} /> : null}
      <View style={styles.list}>
        {BENEFITS.map((b) => (
          <View key={b} style={styles.step}>
            <Icon name="Check" color="success" />
            <Text variant="body">{t(`me_money:PAY-01.${b}`)}</Text>
          </View>
        ))}
      </View>
      <PriceBlock price={eligible ? intro : monthly} thenLine={eligible ? t('me_money:PAY-01.plan_price_eligible') : t('me_money:PAY-01.plan_price_not_eligible')} finePrint={t('me_money:PAY-01.gst_flagged')} testID="price" />
      <TrialTimeline eligible={eligible} reminderDate={fmt(remind)} renewDate={fmt(renew)} trialPrice={intro} renewPrice={monthly} />
      <Text variant="caption" tone="muted" align="center">
        {Platform.OS === 'ios' ? t('me_money:PAY-01.fine_print_ios') : t('me_money:PAY-01.fine_print_android')}
      </Text>
      {!online ? (
        <Text variant="caption" tone="error" align="center">
          {t('me_money:PAY-01.offline')}
        </Text>
      ) : null}
      {purchase.status === 'failed' ? (
        <Text variant="caption" tone="error" align="center" testID="pay-failed">
          {t('learn:LES-11.error')}
        </Text>
      ) : null}
      <Dialog
        open={fakeAsk}
        onOpenChange={setFakeAsk}
        title={app.tPending('learn:WEB-01.fake_pay_title')}
        description={app.tPending('learn:WEB-01.fake_pay_body')}
        confirm={{ label: app.tPending('learn:WEB-01.fake_pay_approve'), onPress: () => void fakePay(true) }}
        cancel={{ label: app.tPending('learn:WEB-01.fake_pay_decline'), onPress: () => void fakePay(false) }}
        testID="fake-pay"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: 10 },
  list: { gap: 10 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
