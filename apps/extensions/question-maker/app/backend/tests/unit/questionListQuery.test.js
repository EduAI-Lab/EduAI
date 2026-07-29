/**
 * Unit coverage for question list filter/search/sort helpers (#1040 review).
 */
import { describe, it, expect } from 'vitest';
import {
  parseCsvParam,
  parseQuestionListFilters,
  buildQuestionListQuery,
} from '../../src/utils/questionListQuery.js';

describe('parseCsvParam / parseQuestionListFilters', () => {
  it('parses comma-separated and array query values', () => {
    expect(parseCsvParam('MCQ,SA')).toEqual(['MCQ', 'SA']);
    expect(parseCsvParam(['easy', 'hard'])).toEqual(['easy', 'hard']);
    expect(parseCsvParam('')).toEqual([]);
  });

  it('keeps only allowed filter/sort values', () => {
    const parsed = parseQuestionListFilters({
      types: 'MCQ,NOPE,SA',
      difficulties: 'hard,banana',
      reasoningLevels: 'factual',
      aiGenerated: 'ai',
      draftStatus: 'reviewed',
      sortBy: 'type',
      search: '  recursion  ',
    });
    expect(parsed.types).toEqual(['MCQ', 'SA']);
    expect(parsed.difficulties).toEqual(['hard']);
    expect(parsed.reasoningLevels).toEqual(['factual']);
    expect(parsed.aiGenerated).toBe('ai');
    expect(parsed.draftStatus).toBe('reviewed');
    expect(parsed.sortBy).toBe('type');
    expect(parsed.search).toBe('recursion');
  });

  it('falls unknown sortBy (including difficulty) back to newest', () => {
    expect(parseQuestionListFilters({ sortBy: 'difficulty' }).sortBy).toBe('newest');
    expect(parseQuestionListFilters({ sortBy: 'banana' }).sortBy).toBe('newest');
  });
});

describe('buildQuestionListQuery', () => {
  it('escapes LIKE metacharacters in search before Prisma contains/ILIKE', () => {
    const { where } = buildQuestionListQuery({ search: 'stack_%frame' });
    expect(where.OR).toHaveLength(2);
    expect(where.OR[0]).toEqual({
      description: { contains: 'stack\\_\\%frame', mode: 'insensitive' },
    });
    expect(where.OR[1]).toEqual({
      variants: {
        some: { questionText: { contains: 'stack\\_\\%frame', mode: 'insensitive' } },
      },
    });
  });

  it('ANDs type filter with variant relation predicates', () => {
    const { where } = buildQuestionListQuery({
      types: ['MCQ'],
      difficulties: ['hard'],
      aiGenerated: 'ai',
      draftStatus: 'draft',
    });
    expect(where.AND).toHaveLength(2);
    expect(where.AND[0]).toEqual({ type: { in: ['MCQ'] } });
    expect(where.AND[1]).toEqual({
      variants: {
        some: {
          difficulty: { in: ['hard'] },
          isAiGenerated: true,
          isDraft: true,
        },
      },
    });
  });

  it('orders by createdAt/id with a tie-breaker for newest/oldest', () => {
    expect(buildQuestionListQuery({ sortBy: 'newest' }).orderBy).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
    expect(buildQuestionListQuery({ sortBy: 'oldest' }).orderBy).toEqual([
      { createdAt: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('orders by type with createdAt/id tie-breakers', () => {
    expect(buildQuestionListQuery({ sortBy: 'type' }).orderBy).toEqual([
      { type: 'asc' },
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });
});
