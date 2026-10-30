// @smriti/ui-native: DESIGN.md §5 components for the Expo apps. Same names and props as @smriti/ui-web.
// Setup (apps/mobile): load `smritiFonts` from "@smriti/ui-native/fonts" with expo-font, wrap the app in
// <SafeAreaProvider> and <UIProvider exam locale assetBaseUrl resolveAsset>, and mount
// "@smriti/ui-native/gallery" on a dev-only route to see every component in light, dark and Hindi.
export * from "./theme";
export * from "./components/Text";
export * from "./components/Icon";
export * from "./components/Pressable";
export * from "./components/Illustration";
export * from "./components/Button";
export * from "./components/SignInButtons";
export * from "./components/Progress";
export * from "./components/Chips";
export * from "./components/Cards";
export * from "./components/FormulaBox";
export * from "./components/Inputs";
export * from "./components/Feedback";
export * from "./components/Overlays";
export * from "./components/Navigation";
export * from "./components/Settings";
export * from "./components/Practice";
export type * from "@smriti/tokens/ui";
