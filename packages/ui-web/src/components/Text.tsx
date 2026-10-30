import type { ElementType, ReactNode } from "react";
import type { TextContract, TextTone, TextVariant } from "@smriti/tokens/ui";
import { cx, subjectAttr } from "../util";

export interface TextProps extends TextContract {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  id?: string;
}

export const textVariantClass: Record<TextVariant, string> = {
  display: "text-display text-balance",
  title: "text-title text-balance",
  heading: "text-heading",
  body: "text-body",
  label: "text-label",
  caption: "text-caption",
};

export const textToneClass: Record<TextTone, string> = {
  ink: "text-ink",
  muted: "text-ink-muted",
  disabled: "text-ink-disabled",
  primary: "text-primary-text",
  subject: "text-subject-text",
  onStrong: "text-subject-on-strong",
  onPrimary: "text-on-primary",
  success: "text-success-text",
  error: "text-error-text",
  warning: "text-warning-text",
  streak: "text-streak-text",
};

const defaultTag: Record<TextVariant, ElementType> = {
  display: "h1",
  title: "h2",
  heading: "h3",
  body: "p",
  label: "span",
  caption: "span",
};

/** Typography from tokens.type. Hindi gets 1.15x line heights through :lang(hi) in tokens.css. */
export function Text({ variant = "body", tone = "ink", numeric, align, subject, heading, as, className, children, testID, id }: TextProps) {
  const Tag = as ?? (heading === false ? "span" : defaultTag[variant]);
  return (
    <Tag
      id={id}
      data-testid={testID}
      {...subjectAttr(subject)}
      className={cx(
        "m-0",
        textVariantClass[variant],
        textToneClass[tone],
        numeric && "tabular-nums",
        align === "center" && "text-center",
        align === "end" && "text-end",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
