import { Button, Sheet, Text } from '@smriti/ui-native';
import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Offer } from '../billing/types';
import { useApp, useT, useUiState } from '../services/context';
import { BuddyLine } from './Onboarding';

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * The catalogue's PRC-17 lines carry the prices as text. Until the i18n owner moves them to
 * placeholders, the amounts are swapped for the store's and the config's (R38): never a price
 * that the server or the store didn't give.
 */
export function withPrices(text: string, intro: string, monthly: string): string {
  return text.replace(/₹99\b/g, monthly).replace(/₹1\b/g, intro);
}

export type LimitKind = 'daily_cap' | 'sectional_mock' | 'locked_mock' | 'report_section';

/**
 * PRC-17, the free limit sheet. Opens only on a tap (R15, R25) and is always dismissible. Under-13s
 * get [Ask a grown-up] and no price.
 */
export function FreeLimitSheet({ open, onOpenChange, kind, limit, weekday, trigger }: { open: boolean; onOpenChange: (o: boolean) => void; kind: LimitKind; limit?: number | null; weekday?: string; trigger: string }) {
  const app = useApp();
  const t = useT();
  const pricing = useUiState((s) => s.config.pricing);
  const [offer, setOffer] = useState<Offer | null>(null);
  const child = app.ageBand() === '10_12' || app.ageBand() === 'u10';
  useEffect(() => {
    if (!open || child) return;
    void app.billing
      .offers()
      .then((o) => setOffer(o[0] ?? null))
      .catch(() => setOffer(null));
  }, [app, open, child]);
  const intro = rupees(offer?.introPricePaise ?? pricing.intro_paise);
  const monthly = rupees(offer?.pricePaise ?? pricing.monthly_paise);
  const title =
    kind === 'daily_cap'
      ? t('practice:PRC-17.title_daily_cap', { limit: limit ?? 0 })
      : kind === 'sectional_mock'
        ? t('practice:PRC-17.title_sectional_mock')
        : kind === 'locked_mock'
          ? t('practice:PRC-17.title_locked_mock')
          : t('practice:PRC-17.title_report_section');
  const go = (href: Href) => {
    onOpenChange(false);
    router.push(href);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} height="60" testID="PRC-17">
      <View style={styles.gap}>
        {kind === 'daily_cap' ? (
          <Text variant="body" tone="muted">
            {t('practice:PRC-17.resets_midnight')}
          </Text>
        ) : null}
        {kind === 'sectional_mock' && weekday ? (
          <Text variant="body" tone="muted">
            {t('practice:PRC-17.next_sectional', { weekday })}
          </Text>
        ) : null}
        <BuddyLine text={t('practice:PRC-17.pet_line')} />
        <Button variant="secondary" label={t('practice:PRC-17.reviews')} icon="Cards" onPress={() => go('/memory' as Href)} testID="limit-reviews" />
        <Button variant="secondary" label={t('practice:PRC-17.next_lesson')} icon="BookBookmark" onPress={() => go('/learn' as Href)} testID="limit-lesson" />
        {child ? (
          <Button label={t('practice:PRC-17.ask_a_grown_up')} onPress={() => go({ pathname: '/paywall', params: { from: trigger, grownup: '1' } })} testID="limit-grown-up" />
        ) : (
          <>
            <Text variant="body">{t('practice:PRC-17.benefit')}</Text>
            <Button label={offer?.introEligible ? withPrices(t('practice:PRC-17.try_pro'), intro, monthly) : t('practice:PRC-01.pro_link')} onPress={() => go({ pathname: '/paywall', params: { from: trigger } })} testID="limit-pro" />
            {offer?.introEligible ? (
              <Text variant="caption" tone="muted" align="center">
                {withPrices(t('practice:PRC-17.fine_print'), intro, monthly)}
              </Text>
            ) : null}
          </>
        )}
        <Button variant="ghost" label={t('practice:PRC-17.not_now')} onPress={() => onOpenChange(false)} testID="limit-not-now" />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({ gap: { gap: 12 } });
