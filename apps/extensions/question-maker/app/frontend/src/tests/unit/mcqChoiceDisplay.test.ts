import { describe, expect, it } from 'vitest';
import {
  getMcqChoiceRowClasses,
  getMcqChoiceLetterClasses,
  CORRECT_ANSWER_SUMMARY_CLASSES,
} from '@/utils/mcqChoiceDisplay';

describe('correct answer highlight', () => {
  it('uses strong success styling for correct MCQ choices', () => {
    expect(getMcqChoiceRowClasses(true)).toContain('border-success-500');
    expect(getMcqChoiceRowClasses(true)).toContain('bg-success-100');
    expect(getMcqChoiceRowClasses(true)).toContain('ring-success-500');
    expect(getMcqChoiceLetterClasses(true)).toContain('bg-success-500');
    expect(getMcqChoiceLetterClasses(true)).toContain('text-white');
  });

  it('uses muted styling for incorrect MCQ choices', () => {
    expect(getMcqChoiceRowClasses(false)).toContain('bg-muted');
    expect(getMcqChoiceLetterClasses(false)).toContain('bg-muted');
  });

  it('uses full-opacity success border on correct answer summary', () => {
    expect(CORRECT_ANSWER_SUMMARY_CLASSES).toContain('border-success-500');
    expect(CORRECT_ANSWER_SUMMARY_CLASSES).toContain('bg-success-100');
    expect(CORRECT_ANSWER_SUMMARY_CLASSES).toContain('border-l-success-500');
    expect(CORRECT_ANSWER_SUMMARY_CLASSES).not.toContain('/60');
  });
});
