import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simConfig } from '@smriti/sim-kit/vite';

export default simConfig(dirname(fileURLToPath(import.meta.url)));
