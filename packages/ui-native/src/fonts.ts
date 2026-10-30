// The eight font files the theme names (packages/tokens/native.ts fontFamilies), by expo-font family name.
// Load them once at app start: `const [loaded] = useFonts(smritiFonts)` from expo-font, before hiding the splash.
// Plus Jakarta Sans and Noto Sans Devanagari are OFL-1.1 (the packages are MIT AND OFL-1.1).
import { PlusJakartaSans_500Medium } from "@expo-google-fonts/plus-jakarta-sans/500Medium";
import { PlusJakartaSans_600SemiBold } from "@expo-google-fonts/plus-jakarta-sans/600SemiBold";
import { PlusJakartaSans_700Bold } from "@expo-google-fonts/plus-jakarta-sans/700Bold";
import { PlusJakartaSans_800ExtraBold } from "@expo-google-fonts/plus-jakarta-sans/800ExtraBold";
import { NotoSansDevanagari_500Medium } from "@expo-google-fonts/noto-sans-devanagari/500Medium";
import { NotoSansDevanagari_600SemiBold } from "@expo-google-fonts/noto-sans-devanagari/600SemiBold";
import { NotoSansDevanagari_700Bold } from "@expo-google-fonts/noto-sans-devanagari/700Bold";
import { NotoSansDevanagari_800ExtraBold } from "@expo-google-fonts/noto-sans-devanagari/800ExtraBold";
import { fontFamilies } from "@smriti/tokens/native";

export const smritiFonts: Record<string, number> = {
  [fontFamilies.latin[500]]: PlusJakartaSans_500Medium as number,
  [fontFamilies.latin[600]]: PlusJakartaSans_600SemiBold as number,
  [fontFamilies.latin[700]]: PlusJakartaSans_700Bold as number,
  [fontFamilies.latin[800]]: PlusJakartaSans_800ExtraBold as number,
  [fontFamilies.devanagari[500]]: NotoSansDevanagari_500Medium as number,
  [fontFamilies.devanagari[600]]: NotoSansDevanagari_600SemiBold as number,
  [fontFamilies.devanagari[700]]: NotoSansDevanagari_700Bold as number,
  [fontFamilies.devanagari[800]]: NotoSansDevanagari_800ExtraBold as number,
};
