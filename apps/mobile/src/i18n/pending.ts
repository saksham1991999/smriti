import type { Translator } from '@smriti/i18n';

import pending from './pending-learn.json';

/**
 * Strings the shared catalogue does not have yet in this branch: `learn:WEB-01.*` (tab names,
 * dev sign-in, fake pay) and `learn:WEB-02.*` (lesson player). They were written for the web app
 * and are copied, EN and HI, from that branch's `packages/i18n` so both apps say the same thing.
 * Only keys missing upstream are added, so once the shared catalogue has them this file does
 * nothing and can be deleted (listed under "Root changes needed").
 */
export function addPendingStrings(tr: Translator): number {
  let added = 0;
  for (const locale of ['en', 'hi'] as const) {
    const missing: Record<string, string> = {};
    for (const [k, v] of Object.entries(pending[locale] as Record<string, string>)) {
      if (!tr.i18n.exists(`learn:${k}`, { lng: locale, fallbackLng: false })) missing[k] = v;
    }
    if (Object.keys(missing).length) {
      tr.i18n.addResources(locale, 'learn', missing);
      added += Object.keys(missing).length;
    }
  }
  return added;
}
