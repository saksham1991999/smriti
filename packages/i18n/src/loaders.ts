/**
 * `@smriti/i18n/loaders`: one dynamic import per locale and namespace, so a bundler (Vite, Metro
 * with async chunks) emits each catalogue as its own chunk. Pass `loadCatalogue` as `load` to
 * `createI18n` from `@smriti/i18n/core`.
 */
import type { Catalogue, CatalogueLoader, Locale, Namespace } from './core';

type ModuleLoader = () => Promise<{ default: Catalogue }>;

export const catalogueLoaders: Record<Locale, Record<Namespace, ModuleLoader>> = {
  en: {
    auth: () => import('./locales/en/auth.json'),
    learn: () => import('./locales/en/learn.json'),
    me_money: () => import('./locales/en/me_money.json'),
    memory_labs: () => import('./locales/en/memory_labs.json'),
    onboarding: () => import('./locales/en/onboarding.json'),
    practice: () => import('./locales/en/practice.json'),
    tutor_social: () => import('./locales/en/tutor_social.json'),
    ui: () => import('./locales/en/ui.json'),
  },
  hi: {
    auth: () => import('./locales/hi/auth.json'),
    learn: () => import('./locales/hi/learn.json'),
    me_money: () => import('./locales/hi/me_money.json'),
    memory_labs: () => import('./locales/hi/memory_labs.json'),
    onboarding: () => import('./locales/hi/onboarding.json'),
    practice: () => import('./locales/hi/practice.json'),
    tutor_social: () => import('./locales/hi/tutor_social.json'),
    ui: () => import('./locales/hi/ui.json'),
  },
};

/** The default loader: `catalogueLoaders[locale][ns]()`. */
export const loadCatalogue: CatalogueLoader = (locale, ns) => catalogueLoaders[locale][ns]();
