import { Icon, PetAvatar, Text, ThemeScope, useTheme } from '@smriti/ui-native';
import type { RefObject } from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';

import type { ShareCardModel } from '../services/share';

// The favicon-size app mark (DESIGN.md §12); decorative, the card's label carries the meaning.
const APP_MARK = require('../../../../brand/logo/favicon/favicon-192.png') as ImageSourcePropType;

export interface ShareCardProps {
  model: ShareCardModel;
  /** Already-localised strings: the card renders live text, nothing is baked into an image. */
  labels: { title: string; result: string; time: string; top: string | null; streak: string | null; date: string; footer: string; alt: string };
  pet: { species: 'cat' | 'dog' };
  cardRef: RefObject<View | null>;
}

/** PRC-13's 4:5 card. Always in the light palette so it reads well in chat apps. */
export function ShareCard(props: ShareCardProps) {
  return (
    <ThemeScope mode="light">
      <CardBody {...props} />
    </ThemeScope>
  );
}

function CardBody({ model, labels, pet, cardRef }: ShareCardProps) {
  const theme = useTheme();
  const c = theme.colors;
  return (
    <View
      ref={cardRef}
      collapsable={false}
      accessible
      accessibilityRole="image"
      accessibilityLabel={labels.alt}
      testID="share-card"
      style={[styles.card, { backgroundColor: c.primaryTint, borderRadius: theme.radius.cardLarge }]}
    >
      <View style={styles.head}>
        <Image source={APP_MARK} style={styles.mark} accessibilityIgnoresInvertColors />
        <View style={styles.grow}>
          <Text variant="label">{labels.title}</Text>
          <Text variant="caption" tone="muted" numeric>
            {labels.date}
          </Text>
        </View>
      </View>
      <View style={styles.result}>
        <Icon name={model.correct ? 'CheckCircle' : 'XCircle'} size={32} weight="fill" color={model.correct ? 'success' : 'inkMuted'} />
        <Text variant="title" heading>
          {labels.result}
        </Text>
      </View>
      <View style={styles.lines}>
        <View style={styles.line}>
          <Icon name="Timer" size={20} color="inkMuted" />
          <Text variant="body" numeric>
            {labels.time}
          </Text>
        </View>
        {labels.top ? (
          <View style={styles.line}>
            <Icon name="Star" size={20} color="inkMuted" />
            <Text variant="body" numeric>
              {labels.top}
            </Text>
          </View>
        ) : null}
        {labels.streak ? (
          <View style={styles.line} testID="share-card-streak">
            <Icon name="Plant" size={20} weight="fill" color="streak" />
            <Text variant="body" numeric>
              {labels.streak}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.foot}>
        <Text variant="caption" tone="muted" style={styles.grow}>
          {labels.footer}
        </Text>
        <PetAvatar species={pet.species} mood={model.correct ? 'proud' : 'sadButHopeful'} size={88} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { aspectRatio: 4 / 5, padding: 20, gap: 16, justifyContent: 'space-between' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 32, height: 32, borderRadius: 8 },
  grow: { flex: 1 },
  result: { gap: 8, alignItems: 'flex-start' },
  lines: { gap: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  foot: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
});
