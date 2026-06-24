import { describe, expect, it } from 'vitest';
import { buildVariantMetadataUpdates } from '@/utils/questionMetadataEdit';

describe('question metadata edit', () => {
  it('skips variant PUT payload for reviewed variants', () => {
    const updates = buildVariantMetadataUpdates({
      isDraft: false,
      currentQuestionText: 'Old text',
      editQuestionText: 'New text',
      currentDifficulty: 'medium',
      editDifficulty: 'hard',
    });
    expect(updates).toEqual({});
  });

  it('includes questionText when draft and text changed', () => {
    const updates = buildVariantMetadataUpdates({
      isDraft: true,
      currentQuestionText: 'Old text',
      editQuestionText: 'New text',
      currentDifficulty: 'medium',
      editDifficulty: 'medium',
    });
    expect(updates).toEqual({ questionText: 'New text' });
  });

  it('includes difficulty when draft and difficulty changed', () => {
    const updates = buildVariantMetadataUpdates({
      isDraft: true,
      currentQuestionText: 'Same',
      editQuestionText: 'Same',
      currentDifficulty: 'medium',
      editDifficulty: 'hard',
    });
    expect(updates).toEqual({ difficulty: 'hard' });
  });

  it('omits variant PUT when draft but nothing changed', () => {
    const updates = buildVariantMetadataUpdates({
      isDraft: true,
      currentQuestionText: 'Same',
      editQuestionText: 'Same',
      currentDifficulty: 'medium',
      editDifficulty: 'medium',
    });
    expect(updates).toEqual({});
  });
});
