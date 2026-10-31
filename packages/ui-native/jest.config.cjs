/** jest-expo. pnpm keeps packages under node_modules/.pnpm, so those paths are transformed too. */
module.exports = {
  preset: "jest-expo",
  setupFiles: ["./jest.setup.ts"],
  // The gallery test took 8 s in a full parallel turbo test run and failed the 5 s default.
  testTimeout: 30000,
  testMatch: ["<rootDir>/test/**/*.test.ts", "<rootDir>/test/**/*.test.tsx"],
  transformIgnorePatterns: [
    "node_modules/(?!(?:\\.pnpm/[^/]+/node_modules/)?(?:(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-native-svg|react-native-reanimated|react-native-worklets|react-native-safe-area-context|phosphor-react-native|@smriti/.*))",
  ],
};
