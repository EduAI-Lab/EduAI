/** Canvas-style preset swatches — re-exported from shared UI theme tokens. */
export { COURSE_COLOR_PRESETS as COURSE_CARD_COLOR_PRESETS } from "@eduai/ui";

import { resolvePaletteAccent } from "@eduai/ui";

export type CourseCardPreference = {
  color?: string;
  nickname?: string;
};

export type CourseCardPreferencesMap = Record<string, CourseCardPreference>;

export const COURSE_CARD_PREFERENCES_KEY = "eduai:course-card-display";

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
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(COURSE_CARD_PREFERENCES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as CourseCardPreferencesMap;
  } catch {
    return {};
  }
}

export function writeCourseCardPreferences(prefs: CourseCardPreferencesMap): void {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(prefs).length === 0) {
      window.localStorage.removeItem(COURSE_CARD_PREFERENCES_KEY);
      return;
    }
    window.localStorage.setItem(COURSE_CARD_PREFERENCES_KEY, JSON.stringify(prefs));
  } catch {
    // Quota or privacy mode — ignore silently; cards keep defaults.
  }
}

export function getCourseDisplayName(
  officialName: string,
  preference?: CourseCardPreference,
): string {
  const nickname = preference?.nickname?.trim();
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
  const next = { ...current };
  if (update === null) {
    delete next[courseId];
    return next;
  }

  const merged: CourseCardPreference = { ...next[courseId], ...update };
  if (merged.nickname !== undefined && !merged.nickname.trim()) {
    delete merged.nickname;
  }
  if (merged.color !== undefined) {
    const normalized = normalizeCourseCardColor(merged.color);
    if (normalized) merged.color = normalized;
    else delete merged.color;
  }

  if (!merged.color && !merged.nickname) {
    delete next[courseId];
  } else {
    next[courseId] = merged;
  }
  return next;
}
