import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  petImageNames,
  plantImageNames,
  type IllustrationContract,
  type PetAvatarContract,
  type PetViewContract,
  type PlantViewContract,
} from "@smriti/tokens/ui";
import { useUI } from "../provider";
import { cx } from "../util";

export interface IllustrationProps extends IllustrationContract {
  className?: string;
  style?: CSSProperties;
}

/**
 * An Agnes illustration by name (DESIGN.md §6). Loads `{assetBaseUrl}{name}.webp`, tries `fallback`
 * names if the file is missing, and shows the P6 placeholder tile (subject tint) while loading.
 * Never draw art here: every image comes from skills/visual-director.
 */
export function Illustration({ name, fallback, alt, decorative, width, height, fit = "contain", dimmed, className, style, testID }: IllustrationProps) {
  const { assetUrl, altFor, t } = useUI();
  const chainKey = [name, ...(fallback ?? [])].join("|");
  const chain = useMemo(() => chainKey.split("|"), [chainKey]);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setIndex(0);
    setLoaded(false);
  }, [chain]);
  const current = chain[Math.min(index, chain.length - 1)] ?? name;
  const text = decorative ? "" : (alt ?? altFor(current) ?? altFor(name) ?? "");
  const failed = index >= chain.length;
  return (
    <span
      data-testid={testID}
      className={cx("inline-block shrink-0", !loaded && "rounded-md bg-subject-tint motion-safe:animate-pulse", className)}
      style={{ width, height, ...style }}
      aria-busy={!loaded || undefined}
    >
      {!failed && (
        <img
          src={assetUrl(current)}
          alt={text}
          aria-hidden={text ? undefined : true}
          width={width}
          height={height}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setIndex((i) => i + 1)}
          className={cx("block h-full w-full select-none", fit === "cover" ? "object-cover" : "object-contain", dimmed && "opacity-60", !loaded && "opacity-0")}
        />
      )}
      {!loaded && !failed && <span className="sr-only">{t("illustration.loading")}</span>}
    </span>
  );
}

export interface PetViewProps extends PetViewContract {
  className?: string;
}

/**
 * The pet by species and mood. Uses the app's Rive renderer when one is provided (UIProvider.renderPet),
 * otherwise the Agnes still for that mood, falling back to the base pose.
 */
export function PetView({ species, mood = "happy", under10, size = 120, alt, decorative, className, testID }: PetViewProps) {
  const { renderPet, reducedMotion } = useUI();
  if (renderPet) {
    return (
      <span data-testid={testID} className={cx("inline-block", className)} style={{ width: size, height: size }}>
        {renderPet({ species, mood, size, alt, reducedMotion })}
      </span>
    );
  }
  const [first, ...rest] = petImageNames(species, mood, under10);
  return <Illustration testID={testID} name={first ?? `${species}-base`} fallback={rest} alt={alt} decorative={decorative} width={size} height={size} className={className} />;
}

export interface PlantViewProps extends PlantViewContract {
  className?: string;
}

/** The streak plant by stage and health (DESIGN.md §6.4). Never shown dead. Rive seam: UIProvider.renderPlant. */
export function PlantView({ stage, health = "thriving", size = 96, alt, decorative, className, testID }: PlantViewProps) {
  const { renderPlant, reducedMotion } = useUI();
  if (renderPlant) {
    return (
      <span data-testid={testID} className={cx("inline-block", className)} style={{ width: size, height: size }}>
        {renderPlant({ stage, health, size, alt, reducedMotion })}
      </span>
    );
  }
  const [first, ...rest] = plantImageNames(stage, health);
  return <Illustration testID={testID} name={first ?? `plant-${stage}`} fallback={rest} alt={alt} decorative={decorative} width={size} height={size} className={className} />;
}

export interface PetAvatarProps extends PetAvatarContract {
  className?: string;
}

/** The pet portrait in a primaryTint circle, for both pets (DESIGN.md §5, Pet avatars). */
export function PetAvatar({ species, mood = "happy", size = 40, alt, className, testID }: PetAvatarProps) {
  return (
    <span
      data-testid={testID}
      className={cx("inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-primary-tint", className)}
      style={{ width: size, height: size }}
    >
      <PetView species={species} mood={mood} size={Math.round(size * 1.2)} alt={alt} decorative={!alt} className="mt-[12%]" />
    </span>
  );
}
