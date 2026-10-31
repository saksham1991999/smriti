import { Redirect, type Href } from 'expo-router';

import { useUiState } from '../src/services/context';
import { STEP_ROUTE } from '../src/services/onboarding';

/** Launch: resume onboarding at the saved step (onboarding §5.3), else Home. */
export default function Index() {
  const ob = useUiState((s) => s.onboarding);
  if (!ob.completedAt) return <Redirect href={STEP_ROUTE[ob.step] as Href} />;
  return <Redirect href="/learn" />;
}
