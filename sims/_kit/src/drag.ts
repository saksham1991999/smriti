/**
 * Pointer dragging inside an SVG scene. Dragging is a shortcut only: every
 * draggable quantity also has a slider, so keyboard and screen-reader users
 * can do the same thing.
 */

export interface DragHandlers {
  onStart?(): void;
  /** Point in the SVG's user units (viewBox coordinates). */
  onMove(x: number, y: number): void;
  onEnd?(): void;
}

export function toSvgPoint(root: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const ctm = root.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

export function draggable(target: SVGElement, root: SVGSVGElement, handlers: DragHandlers): () => void {
  let active: number | null = null;
  const down = (e: PointerEvent): void => {
    if (active !== null) return;
    active = e.pointerId;
    target.setPointerCapture(e.pointerId);
    target.classList.add('dragging');
    handlers.onStart?.();
    const p = toSvgPoint(root, e.clientX, e.clientY);
    handlers.onMove(p.x, p.y);
    e.preventDefault();
  };
  const move = (e: PointerEvent): void => {
    if (e.pointerId !== active) return;
    const p = toSvgPoint(root, e.clientX, e.clientY);
    handlers.onMove(p.x, p.y);
  };
  const up = (e: PointerEvent): void => {
    if (e.pointerId !== active) return;
    active = null;
    target.classList.remove('dragging');
    handlers.onEnd?.();
  };
  target.addEventListener('pointerdown', down);
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
  return () => {
    target.removeEventListener('pointerdown', down);
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
  };
}
