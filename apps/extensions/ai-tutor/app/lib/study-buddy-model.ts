/**
 * The student's explicit study-buddy model pick, kept per account in
 * localStorage so it survives the chat remounting for each activity (#2025).
 */

import { isBrowser } from "@eduai/ui/runtime-env";

const STUDY_BUDDY_MODEL_STORAGE_PREFIX = "ai-tutor:study-buddy-model:v1:";

export function getStudyBuddyModelStorageKey(userId: string): string {
  return `${STUDY_BUDDY_MODEL_STORAGE_PREFIX}${encodeURIComponent(userId)}`;
}

export function loadStudyBuddyModelId(userId: string | null | undefined): string | null {
  if (!isBrowser() || !userId) return null;
  try {
    return localStorage.getItem(getStudyBuddyModelStorageKey(userId)) || null;
  } catch {
    return null;
  }
}

export function saveStudyBuddyModelId(userId: string | null | undefined, modelId: string): void {
  if (!isBrowser() || !userId) return;
  try {
    localStorage.setItem(getStudyBuddyModelStorageKey(userId), modelId);
  } catch {
    // Ignore storage errors; the pick still applies for this activity.
  }
}

/** The preferred model when still selectable, else the admin's default tutor, else the first model. */
export function resolveStudyBuddyModelId<T extends { modelId: string; isDefaultTutor?: boolean }>(
  models: readonly T[],
  preferredModelId: string | null,
): string | undefined {
  if (preferredModelId && models.some((model) => model.modelId === preferredModelId)) {
    return preferredModelId;
  }
  return (models.find((model) => model.isDefaultTutor) ?? models[0])?.modelId;
}
