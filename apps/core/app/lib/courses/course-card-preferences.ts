/** Canvas-style preset swatches — re-exported from shared UI theme tokens. */
export { COURSE_COLOR_PRESETS as COURSE_CARD_COLOR_PRESETS } from "@eduai/ui";

import { parseJsonText } from "~/lib/json-value";
import { resolvePaletteAccent } from "@eduai/ui";
import { isBrowser } from "@eduai/ui/runtime-env";

export type CourseCardPreference = {
  color?: string;
  nickname?: string;
};

/**
 * Every course the user has customised, keyed by course id. A `Map` rather than
 * an object because the key is a course id off a row — a lookup can miss, and
 * saying so is the whole contract here.
 */
export type CourseCardPreferencesMap = Map<string, CourseCardPreference>;

export const COURSE_CARD_PREFERENCES_KEY = "eduai:course-card-display";

/** Max nickname length — keeps card layout stable and caps localStorage payloads. */
export const MAX_COURSE_NICKNAME_LENGTH = 40;

export function normalizeCourseNickname(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.slice(0, MAX_COURSE_NICKNAME_LENGTH);
}

function isHexColor(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(value.trim());
}

function isOklchColor(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("oklch(") && trimmed.endsWith(")");
}

export function isValidCourseCardColor(value: string): boolean {
  return isHexColor(value) || isOklchColor(value);
}

export function normalizeCourseCardColor(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isOklchColor(trimmed)) return trimmed;
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return isHexColor(withHash) ? withHash.toLowerCase() : null;
}

export function readCourseCardPreferences(): CourseCardPreferencesMap {
  if (!isBrowser()) return new Map();
  try {
    const raw = window.localStorage.getItem(COURSE_CARD_PREFERENCES_KEY);
    if (!raw) return new Map();
    const parsed = parseJsonText(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    const result: CourseCardPreferencesMap = new Map();
    for (const [id, entry] of Object.entries(parsed)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const validated: CourseCardPreference = {};
      if (typeof entry.nickname === "string") validated.nickname = entry.nickname;
      if (typeof entry.color === "string") validated.color = entry.color;
      result.set(id, validated);
    }
    return result;
  } catch {
    return new Map();
  }
}

export function writeCourseCardPreferences(prefs: CourseCardPreferencesMap): void {
  if (!isBrowser()) return;
  try {
    if (prefs.size === 0) {
      window.localStorage.removeItem(COURSE_CARD_PREFERENCES_KEY);
      return;
    }
    window.localStorage.setItem(
      COURSE_CARD_PREFERENCES_KEY,
      JSON.stringify(Object.fromEntries(prefs)),
    );
  } catch {
    // Quota or privacy mode — ignore silently; cards keep defaults.
  }
}

export function getCourseDisplayName(
  officialName: string,
  preference?: CourseCardPreference,
): string {
  const nickname = preference?.nickname ? normalizeCourseNickname(preference.nickname) : "";
  return nickname || officialName;
}

export function getCourseHeroColor(preference?: CourseCardPreference): string | undefined {
  const color = preference?.color?.trim();
  if (!color) return undefined;
  return isValidCourseCardColor(color) ? color : undefined;
}

/** Single source of truth for list + detail accent colour. */
export function resolveCourseAccentColor(
  courseId: string,
  preference?: CourseCardPreference,
): string {
  return resolvePaletteAccent(courseId, undefined, getCourseHeroColor(preference));
}

export function mergeCourseCardPreference(
  current: CourseCardPreferencesMap,
  courseId: string,
  update: CourseCardPreference | null,
): CourseCardPreferencesMap {
  const next = new Map(current);
  if (update === null) {
    next.delete(courseId);
    return next;
  }

  const merged: CourseCardPreference = { ...next.get(courseId), ...update };
  if (merged.nickname !== undefined) {
    const normalized = normalizeCourseNickname(merged.nickname);
    if (normalized) merged.nickname = normalized;
    else delete merged.nickname;
  }
  if (merged.color !== undefined) {
    const normalized = normalizeCourseCardColor(merged.color);
    if (normalized) merged.color = normalized;
    else delete merged.color;
  }

  if (!merged.color && !merged.nickname) {
    next.delete(courseId);
  } else {
    next.set(courseId, merged);
  }
  return next;
}
