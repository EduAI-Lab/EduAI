/**
 * Regression tests for listCourseTestableQuestions response validation.
 *
 * Bug: unlike every other function in eduaiClient.js, listCourseTestableQuestions
 * returned `data.questions ?? []` with no Zod validation. A shape change in Core's
 * questions response went undetected — callers silently received an empty array.
 *
 * Fix: validate against EduAiQuestionListSchema and throw a 502 on mismatch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listCourseTestableQuestions } from '../../src/services/eduaiClient.js';

const OFFERING_ID = 'core-offering-cuid-1';

beforeEach(() => {
  process.env.EDUAI_API_KEY = 'test-service-key-abc';
  process.env.EDUAI_BASE_URL = 'http://core.test/api';
});

afterEach(() => {
  delete process.env.EDUAI_API_KEY;
  delete process.env.EDUAI_BASE_URL;
  vi.restoreAllMocks();
});

describe('listCourseTestableQuestions', () => {
  it('throws a 502 error when Core returns an envelope with no questions key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ data: 'unexpected shape — no questions key' }),
    }));

    await expect(listCourseTestableQuestions(OFFERING_ID)).rejects.toMatchObject({
      status: 502,
    });
  });

  it('throws a 502 error when questions field is not an array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ questions: 'not-an-array', total: 1, limit: 20, offset: 0 }),
    }));

    await expect(listCourseTestableQuestions(OFFERING_ID)).rejects.toMatchObject({
      status: 502,
    });
  });

  it('returns the questions array on a valid response', async () => {
    const questions = [
      {
        id: 'q-cuid-1',
        type: 'MCQ',
        difficulty: 'EASY',
        content: 'What is 2+2?',
        choices: [{ letter: 'A', text: '4' }],
        answer: 'A',
      },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ questions, total: 1, limit: 20, offset: 0 }),
    }));

    const result = await listCourseTestableQuestions(OFFERING_ID);
    expect(result).toEqual(questions);
  });

  it('returns an empty array when questions is an empty array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ questions: [], total: 0, limit: 20, offset: 0 }),
    }));

    const result = await listCourseTestableQuestions(OFFERING_ID);
    expect(result).toEqual([]);
  });
});
