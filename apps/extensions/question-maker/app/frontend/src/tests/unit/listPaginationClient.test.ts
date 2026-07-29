/**
 * Frontend coverage for #1040 paginated list unwrap + page-loop fetch-all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
}));

vi.mock('../../services/api', () => ({
  default: { get: getMock, post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { questionService } from '../../services/questionService';
import { assessmentService } from '../../services/assessmentService';

describe('question/assessment list pagination (#1040)', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('getQuestionsPage unwraps { items, total, limit, offset }', async () => {
    getMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [{ id: 1, description: 'Q1', type: 'MCQ', courseId: 9, createdAt: 'a', updatedAt: 'b', variants: [] }],
          total: 55,
          limit: 50,
          offset: 0,
        },
      },
    });

    const page = await questionService.getQuestionsPage({ courseId: 9, limit: 50, offset: 0 });
    expect(page.total).toBe(55);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe(1);
    expect(getMock).toHaveBeenCalledWith('/api/questions', {
      params: { courseId: 9, limit: 50, offset: 0 },
    });
  });

  it('getQuestions without limit page-loops until total is reached', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      description: `Q${i + 1}`,
      type: 'MCQ',
      courseId: 1,
      createdAt: 'a',
      updatedAt: 'b',
      variants: [],
    }));
    const page2 = Array.from({ length: 10 }, (_, i) => ({
      id: 101 + i,
      description: `Q${101 + i}`,
      type: 'MCQ',
      courseId: 1,
      createdAt: 'a',
      updatedAt: 'b',
      variants: [],
    }));

    getMock
      .mockResolvedValueOnce({
        data: { success: true, data: { items: page1, total: 110, limit: 100, offset: 0 } },
      })
      .mockResolvedValueOnce({
        data: { success: true, data: { items: page2, total: 110, limit: 100, offset: 100 } },
      });

    const all = await questionService.getQuestions({ courseId: 1 });
    expect(all).toHaveLength(110);
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it('getAssessments without limit page-loops and scopes by courseId', async () => {
    getMock
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            items: [{ id: 1, name: 'A1', courseId: 7 }],
            total: 2,
            limit: 100,
            offset: 0,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            items: [{ id: 2, name: 'A2', courseId: 7 }],
            total: 2,
            limit: 100,
            offset: 100,
          },
        },
      });

    const all = await assessmentService.getAssessments({ courseId: 7 });
    expect(all).toHaveLength(2);
    expect(getMock.mock.calls[0][1].params).toMatchObject({ courseId: 7, limit: 100, offset: 0 });
  });

  it('getQuestions with limit above server max page-loops instead of silently clamping', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      description: `Q${i + 1}`,
      type: 'MCQ',
      courseId: 1,
      createdAt: 'a',
      updatedAt: 'b',
      variants: [],
    }));
    const page2 = Array.from({ length: 50 }, (_, i) => ({
      id: 101 + i,
      description: `Q${101 + i}`,
      type: 'MCQ',
      courseId: 1,
      createdAt: 'a',
      updatedAt: 'b',
      variants: [],
    }));

    getMock
      .mockResolvedValueOnce({
        data: { success: true, data: { items: page1, total: 150, limit: 100, offset: 0 } },
      })
      .mockResolvedValueOnce({
        data: { success: true, data: { items: page2, total: 150, limit: 100, offset: 100 } },
      });

    const all = await questionService.getQuestions({ courseId: 1, limit: 500 });
    expect(all).toHaveLength(150);
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it('getQuestions throws instead of silently truncating when total exceeds the fetch-all safety cap', async () => {
    // A single page reporting more total rows than the 10,000-row cap allows the
    // loop to reach without ever returning an empty page — reproduces a result
    // set larger than MAX_FETCH_ALL without needing 100+ mocked page responses.
    getMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: Array.from({ length: 100 }, (_, i) => ({
            id: i + 1,
            description: `Q${i + 1}`,
            type: 'MCQ',
            courseId: 1,
            createdAt: 'a',
            updatedAt: 'b',
            variants: [],
          })),
          total: 50_000,
          limit: 100,
          offset: 0,
        },
      },
    });

    await expect(questionService.getQuestions({ courseId: 1 })).rejects.toThrow(/fetch-all safety cap/i);
  });
});
