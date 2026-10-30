// Third-party sign-in buttons: the documented brand exception (DESIGN.md §5, docs/ux/auth.md §0.2).
// Colours come only from tokens.thirdParty (as --sm-google-* / --sm-apple-* variables). No glow and no
// press scale, so they match Google's and Apple's own buttons. On web, Google's own renderButton is the
// default; this button is for the iOS-browser redirect fallback and for previews.
import type { CSSProperties } from "react";
import { AppleLogoIcon } from "@phosphor-icons/react";
import { thirdParty } from "@smriti/tokens";
import type { AppleButtonContract, GoogleButtonContract, TrustLineContract } from "@smriti/tokens/ui";
import googleG from "../assets/google-g.svg";
import { useUI } from "../provider";
import { cx, focusRing } from "../util";
import { Spinner } from "./Button";
import { Icon } from "./Icon";

export interface GoogleButtonProps extends GoogleButtonContract {
  className?: string;
}

/** auto follows the colour mode through --sm-google-*; light and dark are pinned with inline token values. */
const googleTheme = {
  auto: "bg-google-fill text-google-text ring-1 ring-inset ring-google-stroke",
  neutral: "bg-google-neutral-fill text-google-neutral-text",
};

export function GoogleButton({ theme = "auto", text = "continue", platform = "web", loading, disabled, onPress, testID, className }: GoogleButtonProps) {
  const { t, locale } = useUI();
  const pad = thirdParty.google.padding[platform];
  const label = t(text === "signIn" ? "google.signIn" : "google.continue");
  // Explicit light/dark themes use the token values directly (inline, still from tokens.thirdParty).
  const fixed: CSSProperties | undefined =
    theme === "light" || theme === "dark"
      ? { background: thirdParty.google[theme].fill, color: thirdParty.google[theme].text, boxShadow: `inset 0 0 0 ${thirdParty.google.strokeWidth}px ${thirdParty.google[theme].stroke}` }
      : undefined;
  return (
    <button
      type="button"
      data-testid={testID}
      onClick={disabled || loading ? undefined : onPress}
      disabled={disabled}
      aria-busy={loading || undefined}
      style={{ paddingInlineStart: pad.beforeLogo, paddingInlineEnd: pad.afterText, ...fixed }}
      className={cx(
        "relative flex h-button-height w-full items-center justify-center rounded-full",
        theme === "auto" || theme === "neutral" ? googleTheme[theme] : undefined,
        focusRing,
        "active:brightness-95 disabled:opacity-60",
        className,
      )}
    >
      <span className={cx("flex items-center", loading && "invisible")} style={{ gap: pad.afterLogo }}>
        <img src={googleG} alt="" aria-hidden width={20} height={20} className="block size-5 shrink-0" draggable={false} />
        <span
          className={cx("whitespace-nowrap", locale === "hi" ? "font-deva font-semibold" : "font-google font-medium")}
          style={{ fontSize: thirdParty.google.font.size, lineHeight: `${thirdParty.google.font.lineHeight}px` }}
        >
          {label}
        </span>
      </span>
      {loading && <Spinner className="absolute" label={t("common.loading")} />}
    </button>
  );
}

export interface AppleButtonProps extends AppleButtonContract {
  className?: string;
}

/** Preview of the iOS system button (expo-apple-authentication renders the real one). */
export function AppleButton({ appearance = "auto", loading, disabled, onPress, testID, className }: AppleButtonProps) {
  const { t } = useUI();
  const a = thirdParty.apple;
  const fixed: CSSProperties | undefined =
    appearance === "auto"
      ? undefined
      : { background: a[appearance].fill, color: a[appearance].text, boxShadow: appearance === "whiteOutline" ? `inset 0 0 0 1px ${a.whiteOutline.stroke}` : undefined };
  return (
    <button
      type="button"
      data-testid={testID}
      onClick={disabled || loading ? undefined : onPress}
      disabled={disabled}
      aria-busy={loading || undefined}
      style={fixed}
      className={cx("relative flex h-button-height w-full items-center justify-center gap-2 rounded-sheet text-body font-semibold", appearance === "auto" && "bg-apple-fill text-apple-text", focusRing, "disabled:opacity-60", className)}
    >
      <span className={cx("flex items-center gap-2", loading && "invisible")}>
        <AppleGlyph />
        <span>{t("apple.continue")}</span>
      </span>
      {loading && <Spinner className="absolute" label={t("common.loading")} />}
    </button>
  );
}

/** On iOS the system button draws Apple's logo; web previews use Phosphor's AppleLogo, as the mocks do. */
function AppleGlyph() {
  return <AppleLogoIcon aria-hidden size={20} weight="fill" className="shrink-0" />;
}

/** "We never call you or share your email." under the provider buttons on every sign-in surface (R40). */
export function TrustLine({ testID }: TrustLineContract) {
  const { t } = useUI();
  return (
    <p data-testid={testID} className="m-0 text-center text-caption text-balance text-ink-muted">
      <Icon name="ShieldCheck" size={16} weight="fill" color="success" className="mr-1.5 inline-block align-[-3px]" />
      {t("auth.trust")}
    </p>
  );
}
