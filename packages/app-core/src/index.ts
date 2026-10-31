/**
 * `@smriti/app-core`: platform-free business logic shared by the web and mobile apps.
 * No DOM, React Native or Node-only imports. Platform pieces (HTTP, storage, crypto, files)
 * are injected. React hooks live in `@smriti/app-core/react`.
 */
export * from './time';
export * from './crypto';
export * from './platform';

export * from './storage/types';
export * from './storage/memory';

export * from './sync/types';
export * from './sync/outbox';
export * from './sync/activity';
export * from './sync/client';

export * from './auth/types';
export * from './auth/supabase';
export * from './auth/dev';
export * from './auth/softPrompt';

export * from './rules/config';
export * from './rules/day';
export * from './rules/streak';
export * from './rules/plant';
export * from './rules/pet';
export * from './rules/gems';
export * from './rules/quests';

export * from './fsrs/scheduler';
export * from './fsrs/queue';
export * from './fsrs/comeback';
export * from './fsrs/rescue';
export * from './fsrs/config';

export * from './home/hero';
export * from './home/plan';

export * from './entitlements/entitlement';
export * from './entitlements/limits';
export * from './entitlements/price';

export * from './store/appStore';

export * from './content/manager';
export * from './notify/planner';
export * from './notify/widget';

export * from './little/experience';
export * from './little/gentle';
export * from './little/path';
export * from './little/parent';
