/**
 * Browser-side upload budgets mirrored by the Question Maker backend's QM_*
 * settings. The server remains authoritative; these guards avoid reading a
 * file into memory or starting OCR when the request is guaranteed to fail.
 */
export const QUESTION_UPLOAD_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const QUESTION_UPLOAD_MAX_TEXT_CHARS = 120_000;

const formatMiB = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/** Returns an accessible user-facing error, or null when the file is allowed. */
export function validateQuestionUploadFile(file: File): string | null {
  if (file.size > QUESTION_UPLOAD_MAX_FILE_BYTES) {
    return `This file is too large. Choose a file smaller than ${formatMiB(QUESTION_UPLOAD_MAX_FILE_BYTES)}.`;
  }
  return null;
}

/** Returns an accessible user-facing error, or null when text is allowed. */
export function validateQuestionUploadText(text: string): string | null {
  if (text.length > QUESTION_UPLOAD_MAX_TEXT_CHARS) {
    return `The extracted text is too long. Choose a smaller file (maximum ${QUESTION_UPLOAD_MAX_TEXT_CHARS.toLocaleString()} characters).`;
  }
  return null;
}
