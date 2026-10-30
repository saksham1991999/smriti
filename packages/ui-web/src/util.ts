import { subjectFamily } from "@smriti/tokens";

/** Joins class names, skipping falsy values. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** data-subject for a subject id or family, so tokens.css points --sm-subject-* at that family. */
export function subjectAttr(subject?: string): { "data-subject"?: string } {
  return subject ? { "data-subject": subjectFamily(subject) } : {};
}

/** Visible focus ring in primary (3:1 on every surface), shared by every interactive component. */
export const focusRing =
  "outline-none focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-primary";

/** Press feedback: scale to 0.97 over `fast`, only when motion is allowed (DESIGN.md §7). */
export const pressable = "transition-transform duration-fast ease-standard motion-safe:active:scale-press";

/** Grows the hit area to at least 48 x 48 without changing the visual size. */
export const hitArea = "sm-hit";
