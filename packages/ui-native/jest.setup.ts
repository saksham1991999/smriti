// Worklets' and Reanimated's own Jest mocks (no native worklet runtime in Node).
jest.mock("react-native-worklets", () => require("react-native-worklets/src/mock"));
jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock"));
