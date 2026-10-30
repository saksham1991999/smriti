// Used by jest-expo. babel-preset-expo comes with expo (pnpm does not hoist it), and it adds the
// Reanimated / worklets plugin itself. The app's own babel config covers Metro builds.
module.exports = function (api) {
  api.cache(true);
  const preset = require.resolve("babel-preset-expo", { paths: [require.resolve("expo/package.json")] });
  return { presets: [preset] };
};
