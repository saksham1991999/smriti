// Pure layout and keyboard logic for the periodic table teaser (unit tested).

export interface GridElement {
  z: number;
  symbol: string;
  name?: string | undefined;
  period: number;
  group: number | null;
  f_col: number | null;
  block: "s" | "p" | "d" | "f";
}

export type Direction = "left" | "right" | "up" | "down";

/** CSS grid row and column (1-based). The f rows sit in rows 9 and 10, under groups 3–17. */
export function gridPosition(e: GridElement): { row: number; col: number } {
  if (e.f_col !== null) return { row: e.period === 6 ? 9 : 10, col: e.f_col + 3 };
  if (e.group === null) throw new Error(`element ${e.z} has neither group nor f_col`);
  return { row: e.period, col: e.group };
}

/** The element reached from `fromZ` with an arrow key, or `fromZ` when there is none. */
export function moveFocus(elements: readonly GridElement[], fromZ: number, dir: Direction): number {
  const from = elements.find((e) => e.z === fromZ);
  if (!from) return fromZ;
  const a = gridPosition(from);
  let best: { z: number; primary: number; secondary: number } | undefined;
  for (const e of elements) {
    if (e.z === fromZ) continue;
    const b = gridPosition(e);
    const dRow = b.row - a.row;
    const dCol = b.col - a.col;
    let primary: number;
    let secondary: number;
    switch (dir) {
      case "left":
        if (dRow !== 0 || dCol >= 0) continue;
        primary = -dCol;
        secondary = 0;
        break;
      case "right":
        if (dRow !== 0 || dCol <= 0) continue;
        primary = dCol;
        secondary = 0;
        break;
      case "up":
        if (dRow >= 0) continue;
        primary = -dRow;
        secondary = Math.abs(dCol);
        break;
      case "down":
        if (dRow <= 0) continue;
        primary = dRow;
        secondary = Math.abs(dCol);
        break;
    }
    if (
      !best ||
      (dir === "up" || dir === "down"
        ? secondary < best.secondary || (secondary === best.secondary && primary < best.primary)
        : primary < best.primary)
    ) {
      best = { z: e.z, primary, secondary };
    }
  }
  return best?.z ?? fromZ;
}
