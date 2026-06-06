/**
 * Unit tests for assessmentVariantUtils helpers.
 * These are pure/near-pure functions — no DB, no mocks needed.
 */
import { describe, it, expect } from 'vitest';
import { aggregateStructure } from '../../src/services/assessmentVariantUtils.js';

describe('aggregateStructure', () => {
  it('returns all-zero counts for an empty variant list', () => {
    const result = aggregateStructure([]);
    expect(result.topicCounts).toEqual({});
    expect(result.difficultyCounts).toEqual({ easy: 0, medium: 0, hard: 0 });
    expect(result.typeCounts).toEqual({ MCQ: 0, SA: 0, LA: 0 });
    expect(result.baseQuestionIds).toEqual([]);
    expect(result.n).toBe(0);
  });

  it('skips variants that have no questionMetadata entirely — no crash, no count', () => {
    const variants = [{ id: 1, difficulty: 'easy', questionMetadata: null }];
    const result = aggregateStructure(variants);
    expect(result.topicCounts).toEqual({});
    expect(result.difficultyCounts).toEqual({ easy: 0, medium: 0, hard: 0 });
    expect(result.baseQuestionIds).toEqual([]);
  });

  it('does not count a variant whose difficulty is not easy/medium/hard', () => {
    const variants = [
      { difficulty: 'unknown', questionMetadata: { id: 1, type: 'SA', primaryTopicId: 't1' } }
    ];
    const result = aggregateStructure(variants);
    expect(result.difficultyCounts).toEqual({ easy: 0, medium: 0, hard: 0 });
  });

  it('does not count a variant whose type is not MCQ/SA/LA', () => {
    const variants = [
      { difficulty: 'easy', questionMetadata: { id: 1, type: 'TF', primaryTopicId: 't1' } }
    ];
    const result = aggregateStructure(variants);
    expect(result.typeCounts).toEqual({ MCQ: 0, SA: 0, LA: 0 });
  });

  it('counts topic occurrences correctly when multiple variants share a topic', () => {
    const variants = [
      { difficulty: 'easy', questionMetadata: { id: 1, type: 'MCQ', primaryTopicId: 42 } },
      { difficulty: 'medium', questionMetadata: { id: 2, type: 'SA', primaryTopicId: 42 } },
      { difficulty: 'hard', questionMetadata: { id: 3, type: 'LA', primaryTopicId: 99 } }
    ];
    const result = aggregateStructure(variants);
    expect(result.topicCounts['42']).toBe(2);
    expect(result.topicCounts['99']).toBe(1);
  });

  it('accumulates difficulty counts across all variants', () => {
    const meta = { id: 1, type: 'SA', primaryTopicId: 't1' };
    const variants = [
      { difficulty: 'easy', questionMetadata: meta },
      { difficulty: 'easy', questionMetadata: meta },
      { difficulty: 'medium', questionMetadata: meta },
      { difficulty: 'hard', questionMetadata: meta }
    ];
    const result = aggregateStructure(variants);
    expect(result.difficultyCounts).toEqual({ easy: 2, medium: 1, hard: 1 });
  });

  it('accumulates type counts for MCQ, SA, and LA', () => {
    const variants = [
      { difficulty: 'easy', questionMetadata: { id: 1, type: 'MCQ', primaryTopicId: 't1' } },
      { difficulty: 'easy', questionMetadata: { id: 2, type: 'MCQ', primaryTopicId: 't1' } },
      { difficulty: 'easy', questionMetadata: { id: 3, type: 'SA', primaryTopicId: 't1' } },
      { difficulty: 'easy', questionMetadata: { id: 4, type: 'LA', primaryTopicId: 't1' } }
    ];
    const result = aggregateStructure(variants);
    expect(result.typeCounts).toEqual({ MCQ: 2, SA: 1, LA: 1 });
  });

  it('collects baseQuestionIds from metadata of every counted variant', () => {
    const variants = [
      { difficulty: 'easy', questionMetadata: { id: 10, type: 'MCQ', primaryTopicId: 't1' } },
      { difficulty: 'medium', questionMetadata: { id: 20, type: 'SA', primaryTopicId: 't2' } }
    ];
    const result = aggregateStructure(variants);
    expect(result.baseQuestionIds).toEqual([10, 20]);
  });

  it('uses a custom topicKeyFn when provided, overriding the default primaryTopicId lookup', () => {
    const variants = [
      { difficulty: 'easy', questionMetadata: { id: 1, type: 'MCQ', primaryTopicId: 't1' }, customKey: 'OVERRIDE' }
    ];
    const result = aggregateStructure(variants, (v) => v.customKey);
    expect(result.topicCounts['OVERRIDE']).toBe(1);
    expect(result.topicCounts['t1']).toBeUndefined();
  });

  it('treats null primaryTopicId as no topic — does not pollute topicCounts with "null" key', () => {
    const variants = [
      { difficulty: 'easy', questionMetadata: { id: 1, type: 'MCQ', primaryTopicId: null } }
    ];
    const result = aggregateStructure(variants);
    expect(Object.keys(result.topicCounts)).toHaveLength(0);
  });

  it('returns correct n equal to the number of variants passed in', () => {
    const variants = [
      { difficulty: 'easy', questionMetadata: { id: 1, type: 'MCQ', primaryTopicId: 't1' } },
      { difficulty: 'easy', questionMetadata: null }
    ];
    expect(aggregateStructure(variants).n).toBe(2);
  });
});
