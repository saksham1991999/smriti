/**
 * Maths pre-rendering. Every TeX string in a bundle is checked with KaTeX (the TeX subset both
 * players support) and rendered to a self-contained SVG with MathJax, because KaTeX itself only
 * outputs HTML and MathML. Glyphs are paths and the fill is currentColor, so one SVG serves light
 * and dark themes and needs no font on the device.
 */
import katex from "katex";
import "katex/contrib/mhchem";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { SVG } from "mathjax-full/js/output/svg.js";

import { mathKey, splitMath } from "@smriti/content-schema";

export interface RenderedMath {
  tex: string;
  display: boolean;
  svg: string;
  width_ex: number;
  height_ex: number;
  vertical_align_ex: number;
}

export class MathError extends Error {
  constructor(
    readonly tex: string,
    detail: string,
  ) {
    super(`cannot render maths ${JSON.stringify(tex)}: ${detail}`);
  }
}

type MathDoc = ReturnType<typeof mathjax.document>;
let doc: MathDoc | null = null;
let adaptor: ReturnType<typeof liteAdaptor> | null = null;

function mathDoc(): { doc: MathDoc; adaptor: ReturnType<typeof liteAdaptor> } {
  if (!doc || !adaptor) {
    adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const tex = new TeX({
      packages: AllPackages.filter((p: string) => p !== "bussproofs"),
      formatError: (_jax: unknown, err: Error) => {
        throw err;
      },
    });
    const svg = new SVG({ fontCache: "none" });
    doc = mathjax.document("", { InputJax: tex, OutputJax: svg });
  }
  return { doc, adaptor };
}

const cache = new Map<string, RenderedMath>();

/** Render one TeX string. Results are cached by key, so a build renders each formula once. */
export function renderMath(tex: string, display: boolean): RenderedMath {
  const key = display ? mathKey.display(tex) : mathKey.inline(tex);
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: "error", output: "mathml" });
  } catch (e) {
    throw new MathError(tex, `KaTeX: ${(e as Error).message}`);
  }
  const { doc: md, adaptor: ad } = mathDoc();
  let svg: string;
  try {
    const node = md.convert(tex, { display });
    svg = ad.innerHTML(node);
  } catch (e) {
    throw new MathError(tex, `MathJax: ${(e as Error).message}`);
  }
  const out: RenderedMath = {
    tex,
    display,
    svg,
    width_ex: exAttr(svg, /\swidth="([-\d.]+)ex"/),
    height_ex: exAttr(svg, /\sheight="([-\d.]+)ex"/),
    vertical_align_ex: exAttr(svg, /vertical-align:\s*([-\d.]+)ex/),
  };
  cache.set(key, out);
  return out;
}

function exAttr(svg: string, re: RegExp): number {
  const m = svg.match(re);
  return m ? Number(m[1]) : 0;
}

/** Field names whose string value is bare TeX: display maths for `latex`, inline for `symbol`. */
const BARE_TEX_FIELDS: Record<string, boolean> = { latex: true, symbol: false };

/**
 * Collect every maths key in a localised value: `$...$` and `$$...$$` inside text, `latex` fields
 * as display maths and formula `symbol` fields as inline maths.
 */
export function collectMath(value: unknown, into = new Map<string, { tex: string; display: boolean }>()) {
  walk(value, null, into);
  return into;
}

function walk(value: unknown, field: string | null, into: Map<string, { tex: string; display: boolean }>): void {
  if (typeof value === "string") {
    if (field !== null && field in BARE_TEX_FIELDS) {
      const display = BARE_TEX_FIELDS[field] as boolean;
      into.set(display ? mathKey.display(value) : mathKey.inline(value), { tex: value, display });
      return;
    }
    if (!value.includes("$")) return;
    for (const seg of splitMath(value)) {
      if (seg.kind === "math") into.set(seg.key, { tex: seg.value, display: seg.display });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) walk(v, field, into);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      // Ids, refs and answer keys never hold maths.
      if (k === "id" || k === "url" || k === "svg") continue;
      walk(v, k, into);
    }
  }
}

/** Render every key collected from a value into the bundle's math map (sorted by key). */
export function buildMathMap(value: unknown): Record<string, RenderedMath> {
  const found = collectMath(value);
  const out: Record<string, RenderedMath> = {};
  for (const key of [...found.keys()].sort()) {
    const { tex, display } = found.get(key) as { tex: string; display: boolean };
    out[key] = renderMath(tex, display);
  }
  return out;
}
