import type { JsonValue } from "~/lib/json-value";
import { z } from "zod";
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

export function isUiDensity(value: JsonValue | undefined): value is UiDensity {
  return z.enum(UI_DENSITY_VALUES).safeParse(value).success;
}

export function isUiTheme(value: JsonValue | undefined): value is UiTheme {
  return z.enum(UI_THEME_VALUES).safeParse(value).success;
}

/** SSR-safe theme class for explicit light/dark; system leaves class unset. */
export function resolveThemeHtmlClass(theme: UiTheme): "light" | "dark" | undefined {
  if (theme === "light") return "light";
  if (theme === "dark") return "dark";
  return undefined;
}
