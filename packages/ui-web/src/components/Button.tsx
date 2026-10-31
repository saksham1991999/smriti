import type { ButtonHTMLAttributes } from "react";
import type { ButtonContract, ButtonVariant, IconButtonContract } from "@smriti/tokens/ui";
import { cx, focusRing, hitArea, pressable } from "../util";
import { Icon } from "./Icon";

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role={label ? "status" : undefined} className={cx("inline-block size-5 shrink-0", className)}>
      <span aria-hidden className="block size-full rounded-full border-[2.5px] border-current border-r-transparent motion-safe:animate-[sm-spin_0.8s_linear_infinite] motion-reduce:opacity-70" />
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

const variantClass: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary shadow-cta active:bg-primary-pressed",
  secondary: "bg-surface text-ink ring-[1.5px] ring-inset ring-line active:bg-surface-sunken",
  ghost: "bg-transparent text-primary-text active:bg-primary-tint",
  destructive: "bg-error text-on-error active:opacity-90",
};

export interface ButtonProps extends ButtonContract {
  className?: string;
  type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
  /** Extra attributes such as aria-describedby or form. */
  buttonProps?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "disabled" | "type" | "className">;
}

/** DESIGN.md §5 Button: primary (filled, glow), secondary, ghost, destructive; 56 or 40 tall. */
export function Button({
  label,
  variant = "primary",
  size = "lg",
  icon,
  iconPosition = "start",
  loading,
  disabled,
  fullWidth,
  onPress,
  accessibilityLabel,
  testID,
  className,
  type = "button",
  buttonProps,
}: ButtonProps) {
  const full = fullWidth ?? size === "lg";
  const inactive = disabled || loading;
  const iconEl = icon ? <Icon name={icon} size={size === "lg" ? 24 : 20} /> : null;
  return (
    <button
      {...buttonProps}
      type={type}
      data-testid={testID}
      aria-label={accessibilityLabel}
      aria-busy={loading || undefined}
      aria-disabled={inactive || undefined}
      disabled={disabled}
      onClick={inactive ? undefined : onPress}
      className={cx(
        "relative inline-flex select-none items-center justify-center gap-2.5 text-center font-sans font-bold",
        focusRing,
        size === "lg" ? "h-button-height rounded-button px-5 text-body leading-5" : "h-button-height-small rounded-md px-3.5 text-label leading-5",
        size === "sm" && hitArea,
        full ? "w-full" : "w-auto",
        disabled ? "bg-surface-sunken text-ink-muted shadow-none" : variantClass[variant],
        !inactive && pressable,
        loading && "cursor-progress",
        disabled && "cursor-not-allowed",
        className,
      )}
    >
      <span className={cx("inline-flex items-center gap-2.5", loading && "invisible")}>
        {iconPosition === "start" && iconEl}
        <span>{label}</span>
        {iconPosition === "end" && iconEl}
      </span>
      {loading && <Spinner className="absolute" />}
    </button>
  );
}

export interface IconButtonProps extends IconButtonContract {
  className?: string;
  size?: 40 | 44 | 48 | 56;
}

/** Icon-only button with a required label and a 48 px hit area. */
export function IconButton({ icon, label, variant = "plain", weight = "bold", disabled, onPress, testID, className, size = 44 }: IconButtonProps) {
  return (
    <button
      type="button"
      data-testid={testID}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onPress}
      style={{ width: size, height: size }}
      className={cx(
        "relative inline-grid shrink-0 place-items-center rounded-full",
        hitArea,
        focusRing,
        pressable,
        variant === "plain" && "bg-transparent text-ink active:bg-surface-sunken",
        variant === "filled" && "bg-surface text-ink shadow-card",
        variant === "primary" && "bg-primary text-on-primary shadow-raised",
        disabled && "text-ink-disabled",
        className,
      )}
    >
      <Icon name={icon} size={24} weight={weight} />
    </button>
  );
}
