export type PreferenceUpdates = {
  assistDefault?: boolean;
  lastCourseCode?: string | null;
};

/**
 * Picks the valid, persistable subset of an untrusted preferences payload.
 * Unknown keys and wrong-typed values are ignored; a blank course code is
 * normalized to null (cleared). The stored code is a hint only — it is
 * validated against the live course list on read (see resolveSelectedCourse).
 */
export function parsePreferenceUpdates(payload: unknown): PreferenceUpdates {
  const obj = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const updates: PreferenceUpdates = {};

  if (typeof obj.assistDefault === "boolean") {
    updates.assistDefault = obj.assistDefault;
  }

  if (typeof obj.lastCourseCode === "string") {
    const trimmed = obj.lastCourseCode.trim();
    updates.lastCourseCode = trimmed.length > 0 ? trimmed : null;
  } else if (obj.lastCourseCode === null) {
    updates.lastCourseCode = null;
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
