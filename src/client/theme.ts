import type { Settings } from "./types";

export type ThemePreference = Settings["ui"]["theme"];
export type ResolvedTheme = "light" | "dark";

/** Mirrors the pre-paint script in index.html, which reads this key before React loads. */
export const themeStorageKey = "sparklingkit:theme";

export function resolveTheme(preference: ThemePreference | undefined, prefersDark: boolean): ResolvedTheme {
  if (preference === "light" || preference === "dark") return preference;
  return prefersDark ? "dark" : "light";
}

let stopFollowingSystem: (() => void) | undefined;

/** Applies a theme preference to the document; "auto" keeps following the operating system. */
export function applyTheme(preference: ThemePreference | undefined) {
  stopFollowingSystem?.();
  stopFollowingSystem = undefined;
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const apply = () => {
    const theme = resolveTheme(preference, media?.matches ?? true);
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#090a0c" : "#f2f3f5");
  };
  apply();
  try { window.localStorage.setItem(themeStorageKey, preference || "auto"); } catch { /* Storage can be unavailable in private contexts. */ }
  if (preference === "auto" && media) {
    media.addEventListener("change", apply);
    stopFollowingSystem = () => media.removeEventListener("change", apply);
  }
}
