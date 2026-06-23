/** Account-level display preferences (Settings → Accessibility tab). */

export const UI_DENSITY_VALUES = ["comfortable", "compact"] as const;
export type UiDensity = (typeof UI_DENSITY_VALUES)[number];

export const UI_THEME_VALUES = ["system", "light", "dark"] as const;
export type UiTheme = (typeof UI_THEME_VALUES)[number];

export type UiPreferenceFields = {
  motionReduced: boolean;
  density: UiDensity;
  theme: UiTheme;
};

export const DEFAULT_UI_PREFERENCES: UiPreferenceFields = {
  motionReduced: false,
  density: "comfortable",
  theme: "system",
};

export function isUiDensity(value: unknown): value is UiDensity {
  return typeof value === "string" && (UI_DENSITY_VALUES as readonly string[]).includes(value);
}

export function isUiTheme(value: unknown): value is UiTheme {
  return typeof value === "string" && (UI_THEME_VALUES as readonly string[]).includes(value);
}

/** SSR-safe theme class for explicit light/dark; system leaves class unset. */
export function resolveThemeHtmlClass(theme: UiTheme): "light" | "dark" | undefined {
  if (theme === "light") return "light";
  if (theme === "dark") return "dark";
  return undefined;
}
