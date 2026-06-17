import prisma from "~/lib/prisma.server";
import {
  DEFAULT_ACCOUNT_PREFERENCES,
  resolveSelectedCourse,
  type AccountPreferences,
  type PreferenceUpdates,
} from "~/lib/user-preferences";
import { isUiDensity, isUiTheme } from "~/lib/ui-preferences";

export type ChatPreferences = AccountPreferences;

const DEFAULT_PREFERENCES: ChatPreferences = DEFAULT_ACCOUNT_PREFERENCES;

function rowToPreferences(row: {
  assistDefault: boolean;
  lastCourseCode: string | null;
  motionReduced: boolean;
  density: string;
  theme: string;
}): ChatPreferences {
  return {
    assistDefault: row.assistDefault,
    lastCourseCode: row.lastCourseCode,
    motionReduced: row.motionReduced,
    density: isUiDensity(row.density) ? row.density : DEFAULT_PREFERENCES.density,
    theme: isUiTheme(row.theme) ? row.theme : DEFAULT_PREFERENCES.theme,
  };
}

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

  const prefs = rowToPreferences(row);

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
  return rowToPreferences(row);
}

/** Removes a user's stored chat preferences (used on logout). */
export async function clearUserPreference(userId: string): Promise<void> {
  await prisma.userPreference.deleteMany({ where: { userId } });
}
