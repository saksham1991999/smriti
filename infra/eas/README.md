# EAS (mobile builds)

`apps/mobile/eas.json` and `apps/mobile/app.config.ts` belong to the mobile app. This page describes
how deploys use them and lists what they still lack. `.github/workflows/deploy-mobile.yml` runs
`eas build --profile production-<variant> --platform all` for each variant on a `mobile-v*` tag,
after CI has passed and the GitHub `production` environment's reviewers approve.

## What eas.json covers today

- Profiles `development`, `preview` and `production`, each in a per-variant form
  (`<profile>-{all,jee,neet,upsc,ssc}`), which matches every file in `packages/config/variants/`.
  Each sets `APP_VARIANT`.
- Every variant has its own EAS Update channel (`preview-jee`, `production-jee`, and so on).
- `production` uses `autoIncrement` with `appVersionSource: remote`. `node` and `pnpm` are pinned.
- `runtimeVersion: { policy: 'appVersion' }` is in app.config.ts.

## Gaps to close before the first store build (mobile owner)

1. **No `updates.url`.** EAS Update needs `updates: { url: 'https://u.expo.dev/<EAS project id>' }`
   in app.config.ts. Run `eas update:configure`, or derive it from `EAS_PROJECT_ID`. Without it,
   the channels exist but builds never fetch updates.
2. **No `environment` on the build profiles.** The `EXPO_PUBLIC_*` values (API, CDN, sims host, Supabase,
   Google web client id, RevenueCat public keys) live in EAS environment variables
   (`eas env:create --environment preview|production`). Add `"environment": "preview"` and
   `"environment": "production"` to the profiles, so each build pulls the right set.
3. **No `staging` profile.** TRD §17 names a staging environment, the release candidate on store
   internal tracks. `preview` (internal distribution) can stand in, but it builds `.preview` bundle
   ids, so the store's internal track gets a different app from production. Decide which, and add
   `staging-<variant>` profiles if needed.
4. **`submit.production` has no per-app identifiers.** Every variant is its own store app, so
   submit needs one entry per variant, `submit.production-<variant>`, each with
   `ios.ascAppId` and `android.serviceAccountKeyPath` (or the key stored with `eas credentials`).
   Only the owner can create these apps.
5. **No App Attest entitlement.** G-10 verifies App Attest on iOS
   (`APP_ATTEST_ENVIRONMENT`), but `ios.entitlements` lacks
   `com.apple.developer.devicecheck.appattest-environment`. Set it to `production` in production
   builds and `development` otherwise.
6. **`EAS_PROJECT_ID` is read from the build environment.** Set it as an EAS environment
   variable, or as a GitHub secret passed in by the workflow, so `extra.eas.projectId` (push tokens)
   is in every cloud build.

Each of the five variants is a separate store listing (bundle ids `app.smriti.<variant>`), so
the owner creates five App Store Connect apps and five Play Console apps. R7 phases mean only
the Phase 1 variants (`all`, `jee`, `neet`, `upsc`) need to ship first. The workflow's variant
list is one input, so trim it there.
