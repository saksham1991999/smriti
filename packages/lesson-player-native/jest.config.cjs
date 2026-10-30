/** jest-expo. pnpm keeps packages under node_modules/.pnpm, so those paths are transformed too. */
module.exports = {
  preset: "jest-expo",
  setupFiles: ["./jest.setup.ts"],
  testMatch: ["<rootDir>/test/**/*.test.ts", "<rootDir>/test/**/*.test.tsx"],
  // lesson-core and content-schema import "./file.js" from TypeScript sources.
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  transformIgnorePatterns: [
    "node_modules/(?!(?:\\.pnpm/[^/]+/node_modules/)?(?:(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-native-svg|react-native-reanimated|react-native-worklets|react-native-safe-area-context|phosphor-react-native|@smriti/.*|intl-messageformat|@formatjs/.*|i18next-icu|i18next|ts-fsrs))",
  ],
  testTimeout: 30000,
};
