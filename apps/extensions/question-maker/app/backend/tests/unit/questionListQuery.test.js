/**
 * Unit coverage for question list filter/search/sort helpers (#1040 review).
 */
import { describe, it, expect } from 'vitest';
import { Op } from 'sequelize';
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
      sortBy: 'difficulty',
      search: '  recursion  ',
    });
    expect(parsed.types).toEqual(['MCQ', 'SA']);
    expect(parsed.difficulties).toEqual(['hard']);
    expect(parsed.reasoningLevels).toEqual(['factual']);
    expect(parsed.aiGenerated).toBe('ai');
    expect(parsed.draftStatus).toBe('reviewed');
    expect(parsed.sortBy).toBe('difficulty');
    expect(parsed.search).toBe('recursion');
  });
});

describe('buildQuestionListQuery', () => {
  it('matches description OR variant question_text for search', () => {
    const { where } = buildQuestionListQuery({ search: 'stack_%frame' });
    expect(where[Op.and]).toHaveLength(1);
    const or = where[Op.and][0][Op.or];
    expect(or).toHaveLength(2);
    expect(or[0]).toEqual({
      // Both `%` and `_` escaped so ILIKE treats them literally.
      description: { [Op.iLike]: '%stack\\_\\%frame%' },
    });
    expect(or[1].val).toMatch(/question_text ILIKE/i);
    expect(or[1].val).toMatch(/EXISTS/i);
  });

  it('ANDs type filter with variant EXISTS predicates', () => {
    const { where } = buildQuestionListQuery({
      types: ['MCQ'],
      difficulties: ['hard'],
      aiGenerated: 'ai',
      draftStatus: 'draft',
    });
    expect(where[Op.and].length).toBeGreaterThanOrEqual(2);
    expect(where[Op.and][0]).toEqual({ type: { [Op.in]: ['MCQ'] } });
    const existsSql = where[Op.and][1].val;
    expect(existsSql).toMatch(/difficulty IN/i);
    expect(existsSql).toMatch(/is_ai_generated = TRUE/i);
    expect(existsSql).toMatch(/is_draft = TRUE/i);
  });

  it('orders by createdAt/id with a tie-breaker for newest/oldest', () => {
    expect(buildQuestionListQuery({ sortBy: 'newest' }).order).toEqual([
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ]);
    expect(buildQuestionListQuery({ sortBy: 'oldest' }).order).toEqual([
      ['createdAt', 'ASC'],
      ['id', 'ASC'],
    ]);
  });
});
