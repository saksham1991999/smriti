# EAS (mobile builds)

`apps/mobile/eas.json` and `apps/mobile/app.config.ts` belong to the mobile app. This page describes
how deploys use them. `.github/workflows/deploy-mobile.yml` runs
`eas build --profile <profile>-<variant>` for each variant: `production-<variant>` on a `mobile-v*`
tag after CI has passed and the GitHub `production` environment's reviewers approve, and
`staging-<variant>` on a manual `staging` run. Submitting to the stores stays a separate step
(`eas submit`).

## Profiles

| Profile | Distribution | EAS environment | Bundle ids | Channel |
|---|---|---|---|---|
| `development-<variant>` | internal, dev client | `development` | `app.smriti.<variant>.dev` | `development` |
| `preview-<variant>` | internal | `preview` | `app.smriti.<variant>.preview` | `preview-<variant>` |
| `staging-<variant>` | store (TestFlight, Play internal track) | `preview` | `app.smriti.<variant>` | `staging-<variant>` |
| `production-<variant>` | store | `production` | `app.smriti.<variant>` | `production-<variant>` |

- `<variant>` is each file in `packages/config/variants/` (`all`, `jee`, `neet`, `upsc`, `ssc`).
  Each profile sets `APP_VARIANT`; the bundle id comes from the variant file.
- `staging` is the release candidate on the stores' internal tracks (TRD §17). It builds the same
  app as production, with `EXPO_PUBLIC_APP_ENV=staging` and the `preview` EAS environment's values
  (staging API, CDN and Supabase). Store builds use `autoIncrement` with `appVersionSource: remote`.
- `environment` on every profile makes each build pull its `EXPO_PUBLIC_*` values from that EAS
  environment (`eas env:create --environment preview|production`). The names are in
  `apps/mobile/.env.example`.
- Store builds set the App Attest entitlement
  (`com.apple.developer.devicecheck.appattest-environment`) to `production`; the others use
  `development`. Match `APP_ATTEST_ENVIRONMENT` in Railway.
- App links: `ios.associatedDomains` (`applinks:<brand domain>`) and an auto-verified Android intent
  filter come from the variant's deep link prefix (`packages/config/brand.json` plus the variant's
  `deepLinkPath`). The site serves the matching `apple-app-site-association` and `assetlinks.json`
  for the store bundle ids only, so preview and development builds open links in the browser.

## One EAS project per store app

Every variant is its own store listing, so each has its own EAS project. app.config.ts reads
`EAS_PROJECT_ID_<VARIANT>` (for example `EAS_PROJECT_ID_JEE`), falling back to `EAS_PROJECT_ID`,
and sets `extra.eas.projectId` (push tokens) and `updates.url` (`https://u.expo.dev/<id>`) from it.
Set the id twice per project:

- as the GitHub variable `EAS_PROJECT_ID_<VARIANT>`, which the workflow passes to the CLI;
- as an EAS environment variable `EAS_PROJECT_ID_<VARIANT>` in that project's `preview` and
  `production` environments, so the cloud build resolves the same config.

`runtimeVersion: { policy: 'appVersion' }` decides which updates a build accepts. Publish an update
with `eas update --channel production-<variant>` (or `staging-<variant>`).

## Submit

`submit.production-<variant>` and `submit.staging-<variant>` name each store app
(`android.applicationId`, `ios.bundleIdentifier`). The credentials come from the environment, which
EAS substitutes in these fields only:

| Name | What |
|---|---|
| `ASC_API_KEY_PATH`, `ASC_API_KEY_ID`, `ASC_API_KEY_ISSUER_ID` | an App Store Connect API key (App Manager role); the path is an EAS file variable |
| `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | a Play Console service account key with release permission; an EAS file variable |

Android submits to the `internal` track. Promote to production in Play Console.

## Still to do (owner)

- **`ios.ascAppId`** for each app. EAS does not substitute variables in it, so once App Store
  Connect has the apps, add `"ascAppId": "<id>"` to each `submit.production-<variant>.ios` entry.
  Without it, `eas submit` looks the app up by bundle id, which needs an interactive login.
- Create the App Store Connect and Play Console apps. R7 phases mean only the Phase 1 variants
  (`all`, `jee`, `neet`, `upsc`) need to ship first; trim the workflow's variant input to match.
- Sentry for mobile (TRD §3 and §13) is not wired yet: `EXPO_PUBLIC_SENTRY_DSN` is read but no SDK is
  installed. When it lands, its source map upload belongs in the EAS build hooks.
