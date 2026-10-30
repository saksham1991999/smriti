import { Fragment, type ReactNode } from "react";
import { mathKey, splitMath, type RenderedMath } from "@smriti/content-schema";
import { cx } from "@smriti/ui-web";
import { usePlayer } from "./context";

/**
 * Math SVG comes pre-rendered from the publish job (bundle.math). It is our own output, but it is
 * still checked to be a bare <svg> with no script or event handlers before it is inlined.
 */
export function safeSvg(svg: string | undefined): string | null {
  if (!svg) return null;
  const s = svg.trim();
  if (!/^<svg[\s>]/i.test(s) || !/<\/svg>$/i.test(s)) return null;
  if (/<script|<foreignObject|\son[a-z]+\s*=|javascript:|<iframe|<image/i.test(s)) return null;
  return s;
}

function MathSvg({ math, tex, display }: { math: RenderedMath | undefined; tex: string; display: boolean }) {
  const svg = safeSvg(math?.svg);
  if (!svg) {
    // No rendered SVG: show the TeX source plainly rather than guessing a rendering.
    return <code className="rounded-xs bg-surface-sunken px-1 text-ink">{tex}</code>;
  }
  return (
    <span
      role="img"
      aria-label={tex}
      className={cx("[&_svg]:inline-block [&_svg]:max-w-full [&_svg]:fill-current", display ? "my-2 block overflow-x-auto text-center" : "inline-block align-middle")}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** Text with inline `$…$` and display `$$…$$` maths from the bundle. */
export function RichText({ text, className, as = "p" }: { text: string; className?: string; as?: "p" | "span" | "div" }) {
  const { bundle } = usePlayer();
  const segments = splitMath(text);
  const Tag = as;
  const body: ReactNode[] = segments.map((s, i) =>
    s.kind === "text" ? <Fragment key={i}>{s.value}</Fragment> : <MathSvg key={i} math={bundle.math[s.key]} tex={s.value} display={s.display} />,
  );
  return <Tag className={cx("m-0 text-body text-ink", className)}>{body}</Tag>;
}

/** A display formula from a `latex` field. */
export function DisplayMath({ latex, className }: { latex: string; className?: string }) {
  const { bundle } = usePlayer();
  return (
    <div className={cx("text-title text-ink", className)}>
      <MathSvg math={bundle.math[mathKey.display(latex)]} tex={latex} display />
    </div>
  );
}

/** An inline symbol from a formula's `symbols[].symbol`. */
export function InlineMath({ latex }: { latex: string }) {
  const { bundle } = usePlayer();
  return <MathSvg math={bundle.math[mathKey.inline(latex)] ?? bundle.math[mathKey.display(latex)]} tex={latex} display={false} />;
}

export function displaySvg(bundleMath: Record<string, RenderedMath | undefined>, latex: string): string | undefined {
  return safeSvg(bundleMath[mathKey.display(latex)]?.svg) ?? undefined;
}
