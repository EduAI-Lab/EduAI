// OCR Job status for tracking extraction progress
export type OCRJobStatus = 'pending' | 'processing' | 'success' | 'error' | 'discarded';

// Minimal question data stored in history (to avoid localStorage bloat)
export interface StoredQuestion {
  id: string;
  text: string;
  type: 'mcq' | 'short_answer' | 'true_false' | 'fill_in_blank';
  summary?: string;
  /** MCQ choices when type is mcq; restored so user doesn't lose them. */
  choices?: { letter: string; text: string }[];
  /** Correct answer (letter for MCQ, text for others); restored from history. */
  answer?: string | null;
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
  // Assessment details for recovery
  assessmentDetails?: {
    type: string;
    name: string;
    semester: string;
  };
}

// Constants for history management
export const OCR_HISTORY_KEY = 'ocr-upload-history';
export const MAX_HISTORY_ITEMS = 20;
export const HISTORY_RETENTION_DAYS = 7;
export const MAX_STORED_QUESTIONS_PER_JOB = 50;
