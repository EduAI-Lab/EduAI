import { describe, expect, it, vi } from 'vitest';
import {
  QUESTION_UPLOAD_MAX_FILE_BYTES,
  QUESTION_UPLOAD_MAX_TEXT_CHARS,
  validateQuestionUploadFile,
  validateQuestionUploadText,
} from '@/utils/questionUploadLimits';

describe('Question Maker upload resource guards', () => {
  it('rejects an oversized file before any reader/OCR work can start', () => {
    const file = new File(['x'], 'exam.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: QUESTION_UPLOAD_MAX_FILE_BYTES + 1 });

    expect(validateQuestionUploadFile(file)).toMatch(/too large/i);
  });

  it('allows a normal-sized file', () => {
    const file = new File(['x'], 'exam.pdf', { type: 'application/pdf' });
    expect(validateQuestionUploadFile(file)).toBeNull();
  });

  it('rejects extracted text over the server upload budget', () => {
    const upload = vi.fn();
    const text = 'x'.repeat(QUESTION_UPLOAD_MAX_TEXT_CHARS + 1);
    const error = validateQuestionUploadText(text);
    if (!error) upload(text);

    expect(error).toMatch(
      /extracted text|maximum/i,
    );
    expect(upload).not.toHaveBeenCalled();
  });

  it('allows normal extracted text', () => {
    expect(validateQuestionUploadText('Question 1: explain the algorithm.')).toBeNull();
  });
});
