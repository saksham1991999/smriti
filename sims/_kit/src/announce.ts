/**
 * Screen-reader announcements for state changes ("Current: 0.50 amperes").
 * Rate-limited: while a slider is moving, only the settled value is read.
 */

export interface Announcer {
  /** Announce after the value has been still for `settleMs`. */
  settle(text: string): void;
  /** Announce now. */
  now(text: string): void;
  destroy(): void;
}

export function createAnnouncer(region: HTMLElement, settleMs = 700): Announcer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSaid = '';
  const say = (text: string): void => {
    if (text === lastSaid) return;
    lastSaid = text;
    // Clearing first makes screen readers repeat identical text after a change elsewhere.
    region.textContent = '';
    setTimeout(() => {
      region.textContent = text;
    }, 30);
  };
  return {
    settle(text) {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        say(text);
      }, settleMs);
    },
    now(text) {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      lastSaid = '';
      say(text);
    },
    destroy() {
      if (timer !== null) clearTimeout(timer);
    },
  };
}
