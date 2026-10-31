import { learnerExperience, type LearnerExperience, type TabKey } from '@smriti/app-core';
import { useStoreSelector } from '@smriti/app-core/react';
import { useEffect, useMemo } from 'react';

import type { SmritiApp } from '../../services/app';
import { useApp, useUiState } from '../../services/context';
import { deviceLimits, parentSettingsFrom } from '../parent/limits';

/**
 * Friends tab (R46): Phase 2, behind `feature.friends`. The tab is shown to everyone who passes
 * the flag; SOC-02 explains the locked states (guest, minor without consent, parent off).
 */
export function friendsTabEnabled(app: SmritiApp): boolean {
  return app.flags.get('feature.friends') === true;
}

/** The learner experience for this profile, from app-core's rules (R14, R46, gentle mode). */
export function experienceFor(app: SmritiApp): LearnerExperience {
  return learnerExperience(
    { ageBand: app.ageBand(), schoolClass: app.ui.getState().onboarding.schoolClass },
    {
      littleLearnerEnabled: app.flags.get('feature.little_learner') === true,
      friendsEnabled: friendsTabEnabled(app),
      parent: parentSettingsFrom(deviceLimits(app).store.getState().limits),
    },
  );
}

/**
 * The tabs to show. With `feature.little_learner` off, class 1–5 still drops Practice, as the
 * Phase 1 app did (the little learner Home itself waits for the flag).
 */
export function tabsFor(app: SmritiApp, exp: LearnerExperience): readonly TabKey[] {
  if (!exp.littleLearner && app.isLittleLearner()) return exp.tabs.filter((t) => t !== 'practice' && t !== 'friends');
  return exp.tabs;
}

/** Re-renders when the class, band, flags or the parent's settings change. */
export function useExperience(): LearnerExperience {
  const app = useApp();
  const schoolClass = useUiState((s) => s.onboarding.schoolClass);
  const birthYear = useUiState((s) => s.onboarding.birthYear);
  const flags = useUiState((s) => s.config.flags);
  const band = useStoreSelector(app.store, (s) => s.profile?.age_band ?? null);
  const limits = useStoreSelector(deviceLimits(app).store, (s) => s.limits);
  useEffect(() => {
    void deviceLimits(app).load();
  }, [app]);
  return useMemo(() => experienceFor(app), [app, schoolClass, birthYear, flags, band, limits]);
}
