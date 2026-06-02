import prisma from "~/lib/prisma.server";
import type { PreferenceUpdates } from "~/lib/user-preferences";

export type ChatPreferences = {
  assistDefault: boolean;
  lastCourseCode: string | null;
};

const DEFAULT_PREFERENCES: ChatPreferences = {
  assistDefault: false,
  lastCourseCode: null,
};

/** Reads a user's chat preferences, falling back to defaults when unset. */
export async function getUserPreference(userId: string): Promise<ChatPreferences> {
  const row = await prisma.userPreference.findUnique({ where: { userId } });
  if (!row) {
    return DEFAULT_PREFERENCES;
  }
  return {
    assistDefault: row.assistDefault,
    lastCourseCode: row.lastCourseCode,
  };
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
