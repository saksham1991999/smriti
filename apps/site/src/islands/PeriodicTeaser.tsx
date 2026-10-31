// Periodic table teaser island (LAB-13 web notes): the 18-group layout with the two f-block
// rows, arrow-key navigation, block letter in every cell (never colour alone), and a link to
// the full table in the app. Element data is from PubChem (src/data/elements.json).

import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowRightIcon as ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { track } from "../lib/analytics";
import { gridPosition, moveFocus, type Direction, type GridElement } from "./periodic-logic";
import "./periodic.css";

export interface PeriodicStrings {
  tableLabel: string;
  period: string;
  blockLegend: string;
  cell: string;
  atomicNumber: string;
  block: string;
  fRowsNote: string;
  open: string;
  scrollHint: string;
  credit: string;
  pick: string;
}

export interface PeriodicTeaserProps {
  lang: "en" | "hi";
  elements: GridElement[];
  strings: PeriodicStrings;
  openHref: string;
  blockFamily: Record<"s" | "p" | "d" | "f", string>;
}

const fill = (t: string, vars: Record<string, string | number>) =>
  t.replace(/\{(\w+)\}/g, (w, k: string) => (k in vars ? String(vars[k]) : w));

const KEYS: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

export default function PeriodicTeaser({ lang, elements, strings: s, openHref, blockFamily }: PeriodicTeaserProps) {
  const [selected, setSelected] = useState<number>(6);
  const [focusZ, setFocusZ] = useState<number>(1);
  const refs = useRef(new Map<number, HTMLButtonElement>());
  const byZ = useMemo(() => new Map(elements.map((e) => [e.z, e])), [elements]);
  const sel = byZ.get(selected) ?? elements[0]!;
  const label = (e: GridElement) =>
    fill(s.cell, { name: lang === "en" && e.name ? e.name : e.symbol, z: e.z, block: e.block });

  const choose = useCallback((z: number) => {
    setSelected(z);
    setFocusZ(z);
    track("site_periodic_element", { atomic_number: z });
  }, []);

  function onKey(ev: KeyboardEvent<HTMLButtonElement>, z: number) {
    const dir = KEYS[ev.key];
    if (!dir) return;
    ev.preventDefault();
    const next = moveFocus(elements, z, dir);
    if (next !== z) {
      setFocusZ(next);
      refs.current.get(next)?.focus();
    }
  }

  const fam = (b: GridElement["block"]) => `s-${blockFamily[b]}`;

  return (
    <div className="pt" data-testid="periodic-teaser">
      <div className="pt-scroll" role="region" aria-label={s.tableLabel} tabIndex={0}>
        <div className="pt-grid">
          {elements.map((e) => {
            const { row, col } = gridPosition(e);
            return (
              <button
                key={e.z}
                type="button"
                ref={(el) => {
                  if (el) refs.current.set(e.z, el);
                  else refs.current.delete(e.z);
                }}
                className={`pt-cell ${fam(e.block)}${selected === e.z ? " on" : ""}`}
                style={{ gridRow: row, gridColumn: col }}
                tabIndex={focusZ === e.z ? 0 : -1}
                aria-pressed={selected === e.z}
                onClick={() => choose(e.z)}
                onKeyDown={(ev) => onKey(ev, e.z)}
                onFocus={() => setFocusZ(e.z)}
              >
                <span className="z" aria-hidden="true">
                  {e.z}
                </span>
                <span className="b" aria-hidden="true">
                  {e.block}
                </span>
                <span className="sym" aria-hidden="true">
                  {e.symbol}
                </span>
                {/* The name comes from this text, not aria-label, so it never mismatches what is shown. */}
                <span className="visually-hidden">{label(e)}</span>
              </button>
            );
          })}
          <span className="pt-gap f6" style={{ gridRow: 6, gridColumn: 3 }} aria-hidden="true">
            57–71
          </span>
          <span className="pt-gap f7" style={{ gridRow: 7, gridColumn: 3 }} aria-hidden="true">
            89–103
          </span>
          <div className="pt-detail" style={{ gridRow: "1 / span 3", gridColumn: "3 / span 10" }} aria-live="polite">
            <div className={`pt-tile ${fam(sel.block)}`}>
              <span className="z">{sel.z}</span>
              <span className="sym">{sel.symbol}</span>
              <span className="b">{fill(s.blockLegend, { letter: sel.block })}</span>
            </div>
            {lang === "en" && sel.name && <p className="pt-name">{sel.name}</p>}
            <dl className="pt-facts">
              <div>
                <dt>{s.atomicNumber}</dt>
                <dd>{sel.z}</dd>
              </div>
              <div>
                <dt>{s.block}</dt>
                <dd>{sel.block}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
      <p className="pt-hint">{s.scrollHint}</p>
      <div className="pt-foot">
        <ul className="pt-legend" aria-label={s.block}>
          {(["s", "p", "d", "f"] as const).map((b) => (
            <li key={b} className={fam(b)}>
              <span className="sw" aria-hidden="true">
                {b}
              </span>
              {fill(s.blockLegend, { letter: b })}
            </li>
          ))}
        </ul>
        <a className="btn" href={openHref} data-cta="open_lab" data-placement="periodic">
          {s.open}
          <ArrowRight size={20} weight="bold" aria-hidden="true" />
        </a>
      </div>
      <p className="pt-note">
        {s.fRowsNote} {s.credit}
      </p>
    </div>
  );
}
