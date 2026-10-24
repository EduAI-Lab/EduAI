import { isBrowser } from "@eduai/ui/runtime-env";

/** The study buddy model a student picked, kept per account so it carries
 * across activities and lessons (#2025). */
const STORAGE_PREFIX = "ai-tutor:study-buddy-model:";

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(userId)}`;
}

export function loadStudyBuddyModel(userId: string | null | undefined): string | null {
  if (!isBrowser() || !userId) return null;
  try {
    return localStorage.getItem(storageKey(userId)) || null;
  } catch {
    return null;
  }
}

export function saveStudyBuddyModel(userId: string | null | undefined, modelId: string): void {
  if (!isBrowser() || !userId) return;
  try {
    localStorage.setItem(storageKey(userId), modelId);
  } catch {
    // Ignore storage errors; the pick still applies to this chat.
  }
}
