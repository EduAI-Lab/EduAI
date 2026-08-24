import type { JsonValue } from "~/lib/json-value";
import { asBoolean, asJsonObject, asPresentText, asText } from "~/lib/json-value";
import {
  DEFAULT_UI_PREFERENCES,
  isUiDensity,
  isUiTheme,
  type UiDensity,
  type UiTheme,
} from "~/lib/ui-preferences";

export type PreferenceUpdates = {
  assistDefault?: boolean;
  lastCourseCode?: string | null;
  motionReduced?: boolean;
  density?: UiDensity;
  theme?: UiTheme;
};

export type AccountPreferences = {
  assistDefault: boolean;
  lastCourseCode: string | null;
  motionReduced: boolean;
  density: UiDensity;
  theme: UiTheme;
};

export const DEFAULT_ACCOUNT_PREFERENCES: AccountPreferences = {
  assistDefault: false,
  lastCourseCode: null,
  ...DEFAULT_UI_PREFERENCES,
};

/**
 * Picks the valid, persistable subset of an untrusted preferences payload.
 * Unknown keys and wrong-typed values are ignored; a blank course code is
 * normalized to null (cleared). The stored code is a hint only — it is
 * validated against the live course list on read (see resolveSelectedCourse).
 */
export function parsePreferenceUpdates(payload: JsonValue | undefined): PreferenceUpdates {
  const obj = asJsonObject(payload) ?? {};
  const updates: PreferenceUpdates = {};

  const assistDefault = asBoolean(obj.assistDefault);
  if (assistDefault !== null) {
    updates.assistDefault = assistDefault;
  }

  const lastCourseCode = asText(obj.lastCourseCode);
  if (lastCourseCode !== null) {
    updates.lastCourseCode = asPresentText(lastCourseCode);
  } else if (obj.lastCourseCode === null) {
    updates.lastCourseCode = null;
  }

  const motionReduced = asBoolean(obj.motionReduced);
  if (motionReduced !== null) {
    updates.motionReduced = motionReduced;
  }

  if (isUiDensity(obj.density)) {
    updates.density = obj.density;
  }

  if (isUiTheme(obj.theme)) {
    updates.theme = obj.theme;
  }

  return updates;
}

/**
 * Returns the current course code only if it is still in the available set;
 * otherwise null. Used to drop a restored course the user can no longer access.
 */
export function resolveSelectedCourse(
  current: string | null,
  availableCodes: readonly string[],
): string | null {
  return current && availableCodes.includes(current) ? current : null;
}
