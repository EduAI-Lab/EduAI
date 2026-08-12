/**
 * Unit coverage for the bulk question-approval payload contract (#1106).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  parseApprovalTarget,
  prepareApprovalQuestions,
} from '../../src/utils/questionApproval.js';

const normalizeTopicId = (value) => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  return null;
};

describe('parseApprovalTarget', () => {
  it('requires a non-empty questions array before validating the course target', () => {
    expect(parseApprovalTarget({ courseId: 1 })).toEqual({
      error: 'Questions array is required',
    });
    expect(parseApprovalTarget({ courseId: 1, questions: [] })).toEqual({
      error: 'Questions array is required',
    });
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['non-numeric', 'not-a-number'],
    ['zero', 0],
    ['negative', -1],
    ['non-integer', 1.5],
  ])('rejects a %s courseId', (_label, courseId) => {
    expect(parseApprovalTarget({ courseId, questions: [{}] })).toEqual({
      error: 'Valid courseId is required',
    });
  });

  it('normalizes a positive-integer courseId', () => {
    const questions = [{ primaryTopicId: 'topic-1' }];

    expect(parseApprovalTarget({ courseId: '42', questions })).toEqual({
      questions,
      targetCourseId: 42,
    });
  });

  it('supports classId as the legacy target alias', () => {
    const questions = [{ primaryTopicId: 'topic-1' }];

    expect(parseApprovalTarget({ classId: '7', questions })).toEqual({
      questions,
      targetCourseId: 7,
    });
  });
});

describe('prepareApprovalQuestions', () => {
  it('binds every question to the authorized course and preserves caller authorship', () => {
    const questions = [
      {
        description: '  First question  ',
        primaryTopicId: ' topic-1 ',
        type: 'MCQ',
        questionOrder: { assessment: 1 },
      },
      {
        content: 'Second question',
        courseId: '12',
        primaryTopicId: 2,
        type: 'SA',
      },
      {
        classId: 12,
        description: '   ',
        primaryTopicId: 'topic-3',
      },
    ];

    expect(
      prepareApprovalQuestions(questions, {
        targetCourseId: 12,
        createdBy: 'caller-1',
        normalizeTopicId,
      }),
    ).toEqual({
      questions: [
        {
          description: 'First question',
          courseId: 12,
          primaryTopicId: 'topic-1',
          type: 'MCQ',
          questionOrder: { assessment: 1 },
          createdBy: 'caller-1',
        },
        {
          description: 'Second question',
          courseId: 12,
          primaryTopicId: '2',
          type: 'SA',
          questionOrder: undefined,
          createdBy: 'caller-1',
        },
        {
          description: null,
          courseId: 12,
          primaryTopicId: 'topic-3',
          type: undefined,
          questionOrder: undefined,
          createdBy: 'caller-1',
        },
      ],
    });
  });

  it.each([
    ['non-numeric courseId', { courseId: 'other' }],
    ['zero courseId', { courseId: 0 }],
    ['negative classId', { classId: -1 }],
    ['non-integer classId', { classId: 12.5 }],
    ['different courseId', { courseId: 13 }],
    ['different classId', { classId: 13 }],
  ])('rejects a %s override', (_label, override) => {
    const normalizeTopicIdSpy = vi.fn(normalizeTopicId);

    expect(
      prepareApprovalQuestions(
        [{ ...override, primaryTopicId: 'topic-1' }],
        {
          targetCourseId: 12,
          createdBy: 'caller-1',
          normalizeTopicId: normalizeTopicIdSpy,
        },
      ),
    ).toEqual({
      error: 'Each question courseId must match the authorized target course',
    });
    expect(normalizeTopicIdSpy).not.toHaveBeenCalled();
  });

  it('rejects an invalid primary topic after course overrides are validated', () => {
    expect(
      prepareApprovalQuestions(
        [{ courseId: 12, primaryTopicId: '   ' }],
        {
          targetCourseId: 12,
          createdBy: 'caller-1',
          normalizeTopicId,
        },
      ),
    ).toEqual({
      error: 'Each question must include a valid primaryTopicId',
    });
  });
});
