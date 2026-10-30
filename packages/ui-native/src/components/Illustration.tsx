import { useEffect, useMemo, useState } from "react";
import { Image, View, type StyleProp, type ViewStyle } from "react-native";
import {
  petImageNames,
  plantImageNames,
  type IllustrationContract,
  type PetAvatarContract,
  type PetViewContract,
  type PlantViewContract,
} from "@smriti/tokens/ui";
import { useSubject, useTheme, useUI } from "../theme";

export interface IllustrationProps extends IllustrationContract {
  style?: StyleProp<ViewStyle>;
  /** Subject for the loading placeholder tint. */
  subject?: string;
}

/**
 * An Agnes illustration by name (DESIGN.md §6). Resolves through UIProvider (bundled seed-pack image or
 * `{assetBaseUrl}{name}.webp`), tries `fallback` names on error, and shows the P6 placeholder tile
 * (subject tint) while loading. Never draw art here: every image comes from skills/visual-director.
 */
export function Illustration({ name, fallback, alt, decorative, width = 96, height = 96, fit = "contain", dimmed, style, subject, testID }: IllustrationProps) {
  const { assetSource, altFor, t } = useUI();
  const s = useSubject(subject);
  const theme = useTheme();
  const chainKey = [name, ...(fallback ?? [])].join("|");
  const chain = useMemo(() => chainKey.split("|"), [chainKey]);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setIndex(0);
    setLoaded(false);
  }, [chain]);
  const current = chain[Math.min(index, chain.length - 1)] ?? name;
  const failed = index >= chain.length;
  const text = decorative ? "" : (alt ?? altFor(current) ?? altFor(name) ?? "");
  return (
    <View
      testID={testID}
      accessible={Boolean(text) || !loaded}
      accessibilityRole={text ? "image" : undefined}
      accessibilityLabel={text || (!loaded && !failed ? t("illustration.loading") : undefined)}
      accessibilityState={{ busy: !loaded && !failed }}
      importantForAccessibility={text || !loaded ? "yes" : "no-hide-descendants"}
      style={[{ width, height, borderRadius: loaded ? 0 : theme.radius.md, backgroundColor: loaded ? "transparent" : s.tint, overflow: "hidden" }, style]}
    >
      {!failed && (
        <Image
          testID={testID ? `${testID}-image` : undefined}
          source={assetSource(current)}
          onLoad={() => setLoaded(true)}
          onError={() => setIndex((i) => i + 1)}
          resizeMode={fit}
          accessibilityIgnoresInvertColors
          style={{ width, height, opacity: !loaded ? 0 : dimmed ? 0.6 : 1 }}
        />
      )}
    </View>
  );
}

export interface PetViewProps extends PetViewContract {
  style?: StyleProp<ViewStyle>;
}

/** The pet by species and mood. Uses UIProvider.renderPet (the Rive view) when set, else the Agnes still. */
export function PetView({ species, mood = "happy", under10, size = 120, alt, decorative, style, testID }: PetViewProps) {
  const { renderPet, reducedMotion } = useUI();
  if (renderPet) {
    return (
      <View testID={testID} style={[{ width: size, height: size }, style]}>
        {renderPet({ species, mood, size, alt, reducedMotion })}
      </View>
    );
  }
  const [first, ...rest] = petImageNames(species, mood, under10);
  return <Illustration testID={testID} name={first ?? `${species}-base`} fallback={rest} alt={alt} decorative={decorative} width={size} height={size} style={style} />;
}

export interface PlantViewProps extends PlantViewContract {
  style?: StyleProp<ViewStyle>;
}

/** The streak plant by stage and health (DESIGN.md §6.4). Never shown dead. Rive seam: UIProvider.renderPlant. */
export function PlantView({ stage, health = "thriving", size = 96, alt, decorative, style, testID }: PlantViewProps) {
  const { renderPlant, reducedMotion } = useUI();
  if (renderPlant) {
    return (
      <View testID={testID} style={[{ width: size, height: size }, style]}>
        {renderPlant({ stage, health, size, alt, reducedMotion })}
      </View>
    );
  }
  const [first, ...rest] = plantImageNames(stage, health);
  return <Illustration testID={testID} name={first ?? `plant-${stage}`} fallback={rest} alt={alt} decorative={decorative} width={size} height={size} style={style} />;
}

export interface PetAvatarProps extends PetAvatarContract {
  style?: StyleProp<ViewStyle>;
}

/** The pet portrait in a primaryTint circle (DESIGN.md §5, Pet avatars). */
export function PetAvatar({ species, mood = "happy", size = 40, alt, style, testID }: PetAvatarProps) {
  const theme = useTheme();
  const inner = Math.round(size * 1.2);
  return (
    <View
      testID={testID}
      accessible={Boolean(alt)}
      accessibilityRole={alt ? "image" : undefined}
      accessibilityLabel={alt}
      style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.colors.primaryTint, overflow: "hidden", alignItems: "center" }, style]}
    >
      <PetView species={species} mood={mood} size={inner} decorative style={{ marginTop: size * 0.12 }} />
    </View>
  );
}
