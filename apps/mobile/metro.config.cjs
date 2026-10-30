// Metro for the pnpm monorepo. Expo's default config already watches the workspace root and
// follows pnpm symlinks. Two additions:
// 1. Workspace packages written for Node ESM import "./file.js" from TypeScript sources
//    (lesson-core, content-schema). When "./file.js" does not exist, retry as "./file".
// 2. One React: some workspace packages pin a newer patch of react as a dev dependency, so
//    react and react/* always resolve from this app (two Reacts break hooks).
// 3. The seed pack JSON and the bundled illustrations are assets of the app (src/seed/).
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const appOrigin = path.join(__dirname, 'package.json');

const config = getDefaultConfig(__dirname);

const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolve ?? context.resolveRequest;
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
