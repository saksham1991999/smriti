import { create } from "zustand";
import { prefs } from "../platform/web";

/** Night Colour (SET-05): system, light or dark, applied as `data-theme` on <html> for tokens.css. */
export type ThemeMode = "system" | "light" | "dark";

function apply(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
}

export function resolvedDark(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

interface ThemeState {
  mode: ThemeMode;
  reducedMotion: "system" | "on";
  setMode(mode: ThemeMode): void;
  setReducedMotion(v: "system" | "on"): void;
}

const savedMode = (prefs.get("theme") as ThemeMode | null) ?? "system";
apply(savedMode);

export const useTheme = create<ThemeState>((set) => ({
  mode: savedMode,
  reducedMotion: prefs.get("reduced_motion") === "on" ? "on" : "system",
  setMode(mode) {
    prefs.set("theme", mode);
    apply(mode);
    set({ mode });
  },
  setReducedMotion(v) {
    prefs.set("reduced_motion", v);
    set({ reducedMotion: v });
  },
}));
