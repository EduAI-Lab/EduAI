import prisma from "~/lib/prisma.server";
import { resolveSelectedCourse, type PreferenceUpdates } from "~/lib/user-preferences";

export type ChatPreferences = {
  assistDefault: boolean;
  lastCourseCode: string | null;
};

const DEFAULT_PREFERENCES: ChatPreferences = {
  assistDefault: false,
  lastCourseCode: null,
};

/**
 * Reads a user's chat preferences, falling back to defaults when unset.
 * Validates `lastCourseCode` against `availableCourseCodes`; a stored course that
 * is no longer accessible is cleared in the database and returned as null.
 */
export async function getUserPreference(
  userId: string,
  availableCourseCodes: readonly string[],
): Promise<ChatPreferences> {
  const row = await prisma.userPreference.findUnique({ where: { userId } });
  if (!row) {
    return DEFAULT_PREFERENCES;
  }

  const prefs: ChatPreferences = {
    assistDefault: row.assistDefault,
    lastCourseCode: row.lastCourseCode,
  };

  if (
    prefs.lastCourseCode &&
    resolveSelectedCourse(prefs.lastCourseCode, availableCourseCodes) === null
  ) {
    return saveUserPreference(userId, { lastCourseCode: null });
  }

  return prefs;
}

/** Creates or updates a user's chat preferences and returns the stored values. */
export async function saveUserPreference(
  userId: string,
  updates: PreferenceUpdates,
): Promise<ChatPreferences> {
  const row = await prisma.userPreference.upsert({
    where: { userId },
    create: { userId, ...updates },
    update: updates,
  });
  return {
    assistDefault: row.assistDefault,
    lastCourseCode: row.lastCourseCode,
  };
}

/** Removes a user's stored chat preferences (used on logout). */
export async function clearUserPreference(userId: string): Promise<void> {
  await prisma.userPreference.deleteMany({ where: { userId } });
}
