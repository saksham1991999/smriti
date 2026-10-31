import { router, usePathname } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { onForeground } from '../../platform/network';
import { useApp } from '../../services/context';
import { useExperience } from '../little/experience';
import { deviceLimits } from './limits';

/** Screens where a lesson card, mock section or challenge is running: it finishes first. */
const IN_ACTIVITY = /^\/(lesson|mock|challenge|lab)/;
/** Screens the limit never interrupts: SET-19 itself and the way to a parent. */
const EXEMPT = /^\/(times-up|grown-ups|parent)/;

/**
 * SET-16 on the child's device: counts active minutes here, and when the daily limit or the
 * allowed hours end it opens SET-19, after the current card or mock section (me-money §4.7).
 * Rendered once in the root layout; does nothing unless app-core says limits apply here.
 */
export function TimeLimitGuard() {
  const app = useApp();
  const exp = useExperience();
  const path = usePathname();
  const pathRef = useRef(path);
  pathRef.current = path;

  const check = useCallback(() => {
    const p = pathRef.current;
    if (EXEMPT.test(p)) return;
    const s = deviceLimits(app).state(IN_ACTIVITY.test(p));
    if (s.kind === 'times_up') {
      app.track('time_limit_reached', { limit_type: s.reason });
      router.push({ pathname: '/times-up', params: { reason: s.reason } });
    }
  }, [app]);

  useEffect(() => {
    if (!exp.timeLimits) return;
    const limits = deviceLimits(app);
    void limits.refresh().then(check);
    const timer = setInterval(() => {
      void limits.addMinutes(1).then(check);
    }, 60_000);
    const off = onForeground(() => void limits.refresh().then(check));
    return () => {
      clearInterval(timer);
      off?.();
    };
  }, [app, exp.timeLimits, check]);

  useEffect(() => {
    if (exp.timeLimits) check();
  }, [path, exp.timeLimits, check]);

  return null;
}
