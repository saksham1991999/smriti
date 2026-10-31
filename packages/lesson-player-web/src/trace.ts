/**
 * Trace pad helpers for the web. The glyph is drawn from the app's own font (the token font
 * variables), never from drawn paths; the same drawing gives the ink mask that lesson-core's
 * `traceCoverage` measures against.
 */
import { TRACE_BRUSH, type GlyphMask, type TracePoint } from "@smriti/lesson-core";

type Script = "latin" | "devanagari" | "digits";

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

const fontFor = (script: Script, px: number): string =>
  `700 ${px}px ${script === "devanagari" ? cssVar("--sm-font-deva", "sans-serif") : cssVar("--sm-font-sans", "sans-serif")}`;

/** Writes the glyph centred in a square of `size`, at 80% of its height. */
function fillGlyph(ctx: CanvasRenderingContext2D, glyph: string, script: Script, size: number): void {
  ctx.font = fontFor(script, Math.round(size * 0.8));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(glyph, size / 2, size / 2);
}

/** The glyph's ink on a `grid` x `grid` mask, or null where the browser has no 2D canvas. */
export function canvasGlyphMask(glyph: string, script: Script, grid = 48): GlyphMask | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = grid;
  c.height = grid;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = c.getContext("2d");
  } catch {
    ctx = null;
  }
  if (!ctx) return null;
  ctx.fillStyle = "black"; // the mask is never shown; only its alpha is read
  fillGlyph(ctx, glyph, script, grid);
  const data = ctx.getImageData(0, 0, grid, grid).data;
  const ink = new Uint8Array(grid * grid);
  for (let i = 0; i < ink.length; i++) ink[i] = (data[i * 4 + 3] ?? 0) > 96 ? 1 : 0;
  return { width: grid, height: grid, ink };
}

/**
 * Draws the pale glyph and the child's strokes on the pad. Colours come from the tokens
 * (`--sm-ink-disabled`, `--sm-primary`). Returns false when there is no 2D canvas (the player
 * then shows the glyph as text under the pad).
 */
export function drawTrace(c: HTMLCanvasElement, glyph: string, script: Script, strokes: readonly (readonly TracePoint[])[]): boolean {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = c.getContext("2d");
  } catch {
    ctx = null;
  }
  if (!ctx) return false;
  const size = c.width;
  ctx.clearRect(0, 0, size, c.height);
  ctx.fillStyle = cssVar("--sm-ink-disabled", "GrayText");
  fillGlyph(ctx, glyph, script, size);
  ctx.strokeStyle = cssVar("--sm-primary", "CanvasText");
  ctx.lineWidth = size * TRACE_BRUSH * 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of strokes) {
    if (!stroke.length) continue;
    ctx.beginPath();
    ctx.moveTo(stroke[0]!.x * size, stroke[0]!.y * c.height);
    for (const p of stroke.slice(1)) ctx.lineTo(p.x * size, p.y * c.height);
    if (stroke.length === 1) ctx.lineTo(stroke[0]!.x * size + 0.1, stroke[0]!.y * c.height);
    ctx.stroke();
  }
  return true;
}
