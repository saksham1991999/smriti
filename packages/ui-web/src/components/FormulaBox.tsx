import { useMemo } from "react";
import katex from "katex";
import type { FormulaBoxContract } from "@smriti/tokens/ui";
import { useUI } from "../provider";
import { cx, subjectAttr } from "../util";
import { Button } from "./Button";
import { Chip } from "./Chips";

export interface FormulaBoxProps extends FormulaBoxContract {
  className?: string;
}

/**
 * Subject tint, the formula typeset with KaTeX (never faked as plain text, DESIGN.md §3), tappable
 * symbols and "Add to formula vault". Uses the bundle's pre-rendered SVG when given, else renders the
 * KaTeX source. Import "katex/dist/katex.min.css" once (styles.css does).
 */
export function FormulaBox({ latex, svg, subject, label, symbols, onSymbolPress, inVault, onAddToVault, testID, className }: FormulaBoxProps) {
  const { t } = useUI();
  const html = useMemo(() => {
    if (svg) return null;
    try {
      return katex.renderToString(latex, { displayMode: true, throwOnError: false, output: "htmlAndMathml", strict: "ignore" });
    } catch {
      return null;
    }
  }, [latex, svg]);
  return (
    <figure data-testid={testID} {...subjectAttr(subject)} className={cx("m-0 flex flex-col gap-3 rounded-md bg-subject-tint p-[18px] text-ink", className)}>
      <div role="img" aria-label={label} className="overflow-x-auto text-center text-title font-normal">
        {svg ? (
          <span aria-hidden className="inline-block [&_svg]:inline-block [&_svg]:max-w-full [&_svg]:fill-current" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : html ? (
          <span aria-hidden dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span className="text-label text-ink-muted">{t("formula.loading")}</span>
        )}
      </div>
      {symbols && symbols.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-caption text-ink-muted">{t("formula.symbols")}</span>
          <div className="flex flex-wrap gap-2">
            {symbols.map((s) => (
              <Chip key={s.id} kind="filter" label={s.label} onPress={onSymbolPress ? () => onSymbolPress(s.id) : undefined} />
            ))}
          </div>
        </div>
      )}
      {onAddToVault && (
        <Button
          size="sm"
          variant={inVault ? "ghost" : "secondary"}
          icon={inVault ? "CheckCircle" : "Plus"}
          label={inVault ? t("formula.inVault") : t("formula.addToVault")}
          onPress={inVault ? undefined : onAddToVault}
          disabled={false}
          className="self-start"
        />
      )}
    </figure>
  );
}
