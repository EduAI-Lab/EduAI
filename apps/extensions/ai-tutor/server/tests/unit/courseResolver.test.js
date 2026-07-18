/**
 * Unit tests for the Core-course read-through resolver (#1072 step 2).
 *
 * `courseResolver.js` is the ONE seam between `eduaiClient` and every route
 * that needs Core course data. These tests lock in the fail-soft contract
 * (network/5xx failures degrade to empty/null + `coreUnavailable: true`,
 * never a thrown error) and the #819 isPublished read-through gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/eduaiClient.js', () => ({
  fetchCoreCourseSafe: vi.fn(),
  listEduAiCourses: vi.fn(),
}));

import { fetchCoreCourseSafe, listEduAiCourses } from '../../src/services/eduaiClient.js';
import {
  indexCoreCoursesById,
  resolveCoreCourseById,
  resolveCoreCourseList,
  resolveIsPublished,
} from '../../src/services/courseResolver.js';

beforeEach(() => {
  vi.mocked(fetchCoreCourseSafe).mockReset();
  vi.mocked(listEduAiCourses).mockReset();
});

describe('resolveCoreCourseList', () => {
  it('returns the courses array and coreUnavailable:false on success', async () => {
    const courses = [{ id: 'c1' }, { id: 'c2' }];
    vi.mocked(listEduAiCourses).mockResolvedValue(courses);

    const result = await resolveCoreCourseList({ cookie: 'session=abc' });

    expect(result).toEqual({ courses, coreUnavailable: false });
    expect(listEduAiCourses).toHaveBeenCalledTimes(1);
    expect(listEduAiCourses).toHaveBeenCalledWith({ cookie: 'session=abc' });
  });

  it('degrades to empty courses + coreUnavailable:true on a thrown error (network/5xx)', async () => {
    vi.mocked(listEduAiCourses).mockRejectedValue(Object.assign(new Error('boom'), { status: 503 }));

    const result = await resolveCoreCourseList({ cookie: 'session=abc' });

    expect(result).toEqual({ courses: [], coreUnavailable: true });
  });

  it('never loops a per-course fetch — exactly one listEduAiCourses call regardless of catalog size', async () => {
    vi.mocked(listEduAiCourses).mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => ({ id: `c${i}` })),
    );

    await resolveCoreCourseList({ cookie: 'session=abc' });

    expect(listEduAiCourses).toHaveBeenCalledTimes(1);
  });

  it('treats a non-array resolved value as empty', async () => {
    vi.mocked(listEduAiCourses).mockResolvedValue(undefined);

    const result = await resolveCoreCourseList({});

    expect(result).toEqual({ courses: [], coreUnavailable: false });
  });
});

describe('indexCoreCoursesById', () => {
  it('indexes courses by id for O(1) lookup', () => {
    const byId = indexCoreCoursesById([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    expect(byId.get('a')).toEqual({ id: 'a', name: 'A' });
    expect(byId.get('b')).toEqual({ id: 'b', name: 'B' });
    expect(byId.get('missing')).toBeUndefined();
  });

  it('skips entries with no id and handles null/undefined input', () => {
    const byId = indexCoreCoursesById([{ id: 'a' }, { name: 'no id' }, null]);
    expect(byId.size).toBe(1);
    expect(indexCoreCoursesById(undefined).size).toBe(0);
  });
});

describe('resolveCoreCourseById', () => {
  it('returns null course + coreUnavailable:false when coreOfferingId is absent', async () => {
    const result = await resolveCoreCourseById(null);
    expect(result).toEqual({ course: null, coreUnavailable: false });
    expect(fetchCoreCourseSafe).not.toHaveBeenCalled();
  });

  it('returns the resolved course on success', async () => {
    vi.mocked(fetchCoreCourseSafe).mockResolvedValue({ id: 'core-1', name: 'Algorithms' });

    const result = await resolveCoreCourseById('core-1');

    expect(result).toEqual({ course: { id: 'core-1', name: 'Algorithms' }, coreUnavailable: false });
  });

  it('returns null course + coreUnavailable:false on a genuine 404 (fetchCoreCourseSafe returns null)', async () => {
    vi.mocked(fetchCoreCourseSafe).mockResolvedValue(null);

    const result = await resolveCoreCourseById('core-missing');

    expect(result).toEqual({ course: null, coreUnavailable: false });
  });

  it('degrades to null course + coreUnavailable:true on a thrown error (network/5xx)', async () => {
    vi.mocked(fetchCoreCourseSafe).mockRejectedValue(Object.assign(new Error('down'), { status: 503 }));

    const result = await resolveCoreCourseById('core-1');

    expect(result).toEqual({ course: null, coreUnavailable: true });
  });
});

describe('resolveIsPublished (#819)', () => {
  it('prefers Core isPublished when the offering resolves against the batch', () => {
    const offering = { coreOfferingId: 'core-1', isPublished: false };
    const byId = indexCoreCoursesById([{ id: 'core-1', isPublished: true }]);
    expect(resolveIsPublished(offering, byId)).toBe(true);
  });

  it('falls back to the local column when the offering has no Core match', () => {
    const offering = { coreOfferingId: 'core-missing', isPublished: true };
    const byId = indexCoreCoursesById([{ id: 'core-1', isPublished: false }]);
    expect(resolveIsPublished(offering, byId)).toBe(true);
  });

  it('falls back to the local column when coreCoursesById is empty (Core unavailable)', () => {
    const offering = { coreOfferingId: 'core-1', isPublished: true };
    expect(resolveIsPublished(offering, indexCoreCoursesById([]))).toBe(true);
  });

  it('falls back to the local column when the Core course omits isPublished', () => {
    const offering = { coreOfferingId: 'core-1', isPublished: true };
    const byId = indexCoreCoursesById([{ id: 'core-1' }]);
    expect(resolveIsPublished(offering, byId)).toBe(true);
  });
});
