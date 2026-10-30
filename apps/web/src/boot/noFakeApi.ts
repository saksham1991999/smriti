/**
 * Stands in for src/dev/fake-api in builds that must never contain it (production and the real-API
 * e2e build). vite.config.ts points the `@fake-api` alias here.
 */
export function createBrowserFakeApi(): never {
  throw new Error("The fake API is not part of this build");
}
