// babel-preset-expo adds the Reanimated / worklets plugin and expo-router's transforms itself.
// pnpm does not hoist it, so resolve it through expo.
module.exports = function (api) {
  api.cache(true);
  const preset = require.resolve('babel-preset-expo', { paths: [require.resolve('expo/package.json')] });
  return { presets: [preset] };
};
