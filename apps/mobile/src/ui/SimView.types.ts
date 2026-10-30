import type { HostEvent, HostSession, InitPayload } from '@smriti/sim-bridge';

import type { LabEntry } from '../content/labs';
import type { SimLocation } from '../services/labs';

export interface SimViewProps {
  lab: LabEntry;
  location: SimLocation;
  init: Omit<InitPayload, 'protocolVersion'>;
  /** `sim.ready_timeout_ms` (or `_low` on low-tier phones). */
  readyTimeoutMs: number;
  maxStateHz?: number;
  maxErrors?: number;
  /** "Simulation: {title}", the one label of the region. */
  label: string;
  /** The live session once the host exists; null when it is torn down. */
  onHost: (session: HostSession | null) => void;
  onEvent: (event: HostEvent) => void;
  testID?: string;
}
