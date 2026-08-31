// OCR Job status for tracking extraction progress
import { isBrowser } from "@eduai/ui/runtime-env";
export type OCRJobStatus = "pending" | "processing" | "success" | "error" | "discarded";

// Minimal question data stored in history (to avoid localStorage bloat)
export interface StoredQuestion {
  id: string;
  text: string;
  type: "mcq" | "short_answer" | "true_false" | "fill_in_blank";
  summary?: string;
  /** MCQ choices when type is mcq; restored so user doesn't lose them. */
  choices?: { letter: string; text: string }[];
  /** Correct answer (letter for MCQ, text for others); restored from history. */
  answer?: string | null;
  /** Multi-correct MCQ (#1360); restored from history when present. */
  selectAllThatApply?: boolean;
  correctAnswers?: string[] | null;
}

// OCR Job record for history tracking
export interface OCRJob {
  id: string;
  fileName: string;
  fileSize?: number;
  courseId: number;
  courseName: string;
  model: string;
  status: OCRJobStatus;
  createdAt: string; // ISO timestamp
  completedAt?: string; // ISO timestamp
  error?: string; // Error message if failed
  questionsCount?: number; // Number of extracted questions
  // Only store minimal question data for recovery
  storedQuestions?: StoredQuestion[];
  // Assessment details for recovery. Semester is no longer stored here — it's
  // derived from the course's Core term at creation (#1072 §4 step 8 / #1077).
  assessmentDetails?: {
    type: string;
    name: string;
  };
}

// Constants for account-bound history management
/** Legacy unscoped key. Its contents are discarded because no owner can be established safely. */
export const OCR_HISTORY_KEY = "ocr-upload-history";
export const OCR_HISTORY_KEY_PREFIX = `${OCR_HISTORY_KEY}:v2:`;
export const OCR_HISTORY_CLEARED_EVENT = "eduai:ocr-history-cleared";

export function getOCRHistoryStorageKey(userId: string | null | undefined): string | null {
  const normalizedUserId = userId?.trim();
  return normalizedUserId
    ? `${OCR_HISTORY_KEY_PREFIX}${encodeURIComponent(normalizedUserId)}`
    : null;
}

export function clearOCRHistoryForUser(userId: string | null | undefined): void {
  if (!isBrowser()) return;
  const storageKey = getOCRHistoryStorageKey(userId);
  try {
    if (storageKey) localStorage.removeItem(storageKey);
    localStorage.removeItem(OCR_HISTORY_KEY);
  } catch {
    // Continue logout even when browser storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(OCR_HISTORY_CLEARED_EVENT, { detail: { userId } }));
}

export const MAX_HISTORY_ITEMS = 20;
export const HISTORY_RETENTION_DAYS = 7;
export const MAX_STORED_QUESTIONS_PER_JOB = 50;
