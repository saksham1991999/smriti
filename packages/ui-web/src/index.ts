// @smriti/ui-web: DESIGN.md §5 components for the React web app. Same names and props as @smriti/ui-native.
// Setup (apps/web): import "@smriti/ui-web/fonts.css" and, in the Tailwind entry CSS,
//   @import "tailwindcss";
//   @import "@smriti/ui-web/styles.css";
// then wrap the app in <UIProvider locale assetBaseUrl> and set data-theme / data-exam / lang (or use <ThemeScope>).
export * from "./provider";
export { cx, subjectAttr, focusRing } from "./util";
export * from "./components/Text";
export * from "./components/Icon";
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
