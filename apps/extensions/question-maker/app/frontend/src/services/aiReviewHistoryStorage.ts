import type { VariantAiReviewResult } from "./assessmentVariantService";
import { isBrowser } from "@eduai/ui/runtime-env";

/** Unsafe pre-account-scoping key. Its contents are discarded, never guessed/migrated. */
export const AI_REVIEW_HISTORY_LEGACY_KEY = "assessmentVariant.aiReview.history.v1";
export const AI_REVIEW_HISTORY_KEY_PREFIX = "assessmentVariant.aiReview.history.v2:";
export const AI_REVIEW_HISTORY_MAX_ITEMS = 40;
export const AI_REVIEW_HISTORY_CLEARED_EVENT = "eduai:ai-review-history-cleared";

export interface AiReviewHistoryItem {
  id: string;
  createdAt: string;
  courseId: number;
  baselineAssessmentId: number;
  baselineName: string;
  variantAssessmentId: number;
  variantName: string;
  model: string;
  result: VariantAiReviewResult;
}

export function getAiReviewHistoryStorageKey(userId: string | null | undefined): string | null {
  const normalizedUserId = userId?.trim();
  return normalizedUserId
    ? `${AI_REVIEW_HISTORY_KEY_PREFIX}${encodeURIComponent(normalizedUserId)}`
    : null;
}

export function discardLegacyAiReviewHistory(): void {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(AI_REVIEW_HISTORY_LEGACY_KEY);
  } catch {
    // The legacy entry remains inaccessible even when storage is unavailable.
  }
}

export function loadAiReviewHistory(storageKey: string | null): AiReviewHistoryItem[] {
  if (!isBrowser() || !storageKey) return [];
  discardLegacyAiReviewHistory();
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? (parsed as AiReviewHistoryItem[]).slice(0, AI_REVIEW_HISTORY_MAX_ITEMS)
      : [];
  } catch {
    localStorage.removeItem(storageKey);
    return [];
  }
}

export function saveAiReviewHistory(storageKey: string | null, items: AiReviewHistoryItem[]): void {
  if (!isBrowser() || !storageKey) return;
  try {
    const limitedItems = items.slice(0, AI_REVIEW_HISTORY_MAX_ITEMS);
    if (limitedItems.length === 0) {
      localStorage.removeItem(storageKey);
    } else {
      localStorage.setItem(storageKey, JSON.stringify(limitedItems));
    }
  } catch {
    // History is a recovery convenience; storage failures must not break review work.
  }
}

export function clearAiReviewHistoryForUser(userId: string | null | undefined): void {
  if (!isBrowser()) return;
  const storageKey = getAiReviewHistoryStorageKey(userId);
  try {
    if (storageKey) localStorage.removeItem(storageKey);
    localStorage.removeItem(AI_REVIEW_HISTORY_LEGACY_KEY);
  } catch {
    // Continue logout even when browser storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(AI_REVIEW_HISTORY_CLEARED_EVENT, { detail: { userId } }));
}
