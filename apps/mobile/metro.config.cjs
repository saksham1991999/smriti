// Metro for the pnpm monorepo. Expo's default config already watches the workspace root and
// follows pnpm symlinks. Two additions:
// 1. Workspace packages written for Node ESM import "./file.js" from TypeScript sources
//    (lesson-core, content-schema). When "./file.js" does not exist, retry as "./file".
// 2. The seed pack JSON and the bundled illustrations are assets of the app (src/seed/).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolve ?? context.resolveRequest;
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
