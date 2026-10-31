// Metro for the pnpm monorepo. Expo's default config already watches the workspace root and
// follows pnpm symlinks. Additions:
// 1. Workspace packages written for Node ESM import "./file.js" from TypeScript sources
//    (lesson-core, content-schema). When "./file.js" does not exist, retry as "./file".
// 2. One React: some workspace packages pin a newer patch of react as a dev dependency, so
//    react and react/* always resolve from this app (two Reacts break hooks).
// 3. The seed pack JSON and the bundled illustrations are assets of the app (src/seed/).
// 4. Bundle size: `@smriti/content-schema` resolves to its `./runtime` entry (no Ajv, no JSON
//    schemas). Phosphor icons are already imported one module each by ui-native.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { getDefaultConfig } = require('expo/metro-config');

// The app bundles the generated seed pack (src/seed/generated). EAS native builds and a direct
// `expo export` reach Metro without the package scripts, so make the seed here as well.
execFileSync(process.execPath, [path.join(__dirname, 'scripts', 'seed-pack.mjs')], { stdio: 'inherit' });

const appOrigin = path.join(__dirname, 'package.json');

const config = getDefaultConfig(__dirname);

const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolve ?? context.resolveRequest;
  // lesson-core still imports the package root; the app and lesson-player-native import ./runtime.
  if (moduleName === '@smriti/content-schema') {
    return resolve(context, '@smriti/content-schema/runtime', platform);
  }
  if (moduleName === 'react' || moduleName.startsWith('react/')) {
    return resolve({ ...context, originModulePath: appOrigin }, moduleName, platform);
  }
  try {
    return resolve(context, moduleName, platform);
  } catch (err) {
    if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
      return resolve(context, moduleName.slice(0, -3), platform);
    }
    throw err;
  }
};

module.exports = config;
