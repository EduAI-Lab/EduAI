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
  listEduAiCoursesServiceKey: vi.fn(),
}));

import { fetchCoreCourseSafe, listEduAiCourses, listEduAiCoursesServiceKey } from '../../src/services/eduaiClient.js';
import {
  indexCoreCoursesById,
  resolveCoreCourseById,
  resolveCoreCourseList,
  resolveIsPublished,
  resolveMissingCoreCourses,
} from '../../src/services/courseResolver.js';

beforeEach(() => {
  vi.mocked(fetchCoreCourseSafe).mockReset();
  vi.mocked(listEduAiCourses).mockReset();
  vi.mocked(listEduAiCoursesServiceKey).mockReset();
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

// #1072 step 4: CourseOffering has no local `isPublished` column anymore —
// Core is the sole source of truth. Every case where the offering doesn't
// resolve against the batch fails closed to `false` rather than falling back
// to a stale local value.
describe('resolveIsPublished (#819)', () => {
  it('prefers Core isPublished when the offering resolves against the batch', () => {
    const offering = { coreOfferingId: 'core-1' };
    const byId = indexCoreCoursesById([{ id: 'core-1', isPublished: true }]);
    expect(resolveIsPublished(offering, byId)).toBe(true);
  });

  it('fails closed to false when the offering has no Core match', () => {
    const offering = { coreOfferingId: 'core-missing' };
    const byId = indexCoreCoursesById([{ id: 'core-1', isPublished: false }]);
    expect(resolveIsPublished(offering, byId)).toBe(false);
  });

  it('fails closed to false when coreCoursesById is empty (Core unavailable)', () => {
    const offering = { coreOfferingId: 'core-1' };
    expect(resolveIsPublished(offering, indexCoreCoursesById([]))).toBe(false);
  });

  it('fails closed to false when the Core course omits isPublished', () => {
    const offering = { coreOfferingId: 'core-1' };
    const byId = indexCoreCoursesById([{ id: 'core-1' }]);
    expect(resolveIsPublished(offering, byId)).toBe(false);
  });
});

// #1082: AT and Core enrollment are independent tracks. A caller AT-enrolled
// in a course they aren't Core-enrolled in is silently absent from the
// cookie-scoped batch (`resolveCoreCourseList`) — `resolveMissingCoreCourses`
// fills that gap via one service-key catalog fetch, never per-course.
describe('resolveMissingCoreCourses (#1082)', () => {
  it('scoped-hit: skips the service-key call entirely when every id already resolves', async () => {
    const byId = indexCoreCoursesById([{ id: 'core-1', isPublished: true, callerEnrollmentRole: 'STUDENT' }]);

    const result = await resolveMissingCoreCourses(byId, ['core-1']);

    expect(listEduAiCoursesServiceKey).not.toHaveBeenCalled();
    expect(result).toBe(byId); // same Map instance — no-op
    expect(result.get('core-1')).toEqual({ id: 'core-1', isPublished: true, callerEnrollmentRole: 'STUDENT' });
  });

  it('scoped-miss + service-key-hit: merges the missing course in from the full catalog', async () => {
    const byId = indexCoreCoursesById([{ id: 'core-scoped', isPublished: true }]);
    vi.mocked(listEduAiCoursesServiceKey).mockResolvedValue([
      { id: 'core-scoped', isPublished: true }, // present in both — cookie-scoped entry must win
      { id: 'core-at-only', isPublished: true },
    ]);

    const result = await resolveMissingCoreCourses(byId, ['core-scoped', 'core-at-only']);

    expect(listEduAiCoursesServiceKey).toHaveBeenCalledTimes(1);
    expect(result.get('core-at-only')).toEqual({ id: 'core-at-only', isPublished: true });
    // Cookie-scoped map is untouched — a new Map is returned.
    expect(byId.has('core-at-only')).toBe(false);
  });

  it('never overwrites a cookie-scoped entry (callerEnrollmentRole) with the service-key one', async () => {
    const byId = indexCoreCoursesById([{ id: 'core-1', isPublished: true, callerEnrollmentRole: 'STUDENT' }]);
    vi.mocked(listEduAiCoursesServiceKey).mockResolvedValue([
      { id: 'core-1', isPublished: true }, // no callerEnrollmentRole (service-key shape)
      { id: 'core-2', isPublished: false },
    ]);

    // core-1 already resolves — only core-2 is "missing," so only core-2
    // should be merged in even though the catalog also contains core-1.
    const result = await resolveMissingCoreCourses(byId, ['core-1', 'core-2']);

    expect(result.get('core-1')).toEqual({ id: 'core-1', isPublished: true, callerEnrollmentRole: 'STUDENT' });
    expect(result.get('core-2')).toEqual({ id: 'core-2', isPublished: false });
  });

  it('both-miss: a course absent from both the cookie list AND the service-key catalog stays unresolved (hidden)', async () => {
    const byId = indexCoreCoursesById([]);
    vi.mocked(listEduAiCoursesServiceKey).mockResolvedValue([{ id: 'core-unrelated', isPublished: true }]);

    const result = await resolveMissingCoreCourses(byId, ['core-deleted-or-unknown']);

    expect(result.has('core-deleted-or-unknown')).toBe(false);
    expect(resolveIsPublished({ coreOfferingId: 'core-deleted-or-unknown' }, result)).toBe(false);
  });

  it('dedupes and batches: many missing ids still trigger exactly one service-key call', async () => {
    const byId = indexCoreCoursesById([]);
    vi.mocked(listEduAiCoursesServiceKey).mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({ id: `core-${i}`, isPublished: true })),
    );

    const ids = Array.from({ length: 20 }, (_, i) => `core-${i}`);
    // Duplicate every id once — a naive implementation might fetch per unique
    // occurrence rather than per unique id.
    await resolveMissingCoreCourses(byId, [...ids, ...ids]);

    expect(listEduAiCoursesServiceKey).toHaveBeenCalledTimes(1);
  });

  it('ignores null/undefined ids in the wanted list', async () => {
    const byId = indexCoreCoursesById([]);
    vi.mocked(listEduAiCoursesServiceKey).mockResolvedValue([]);

    const result = await resolveMissingCoreCourses(byId, [null, undefined, '']);

    expect(listEduAiCoursesServiceKey).not.toHaveBeenCalled();
    expect(result).toBe(byId);
  });

  it('fails soft on a service-key fetch error — misses stay unresolved rather than throwing', async () => {
    const byId = indexCoreCoursesById([]);
    vi.mocked(listEduAiCoursesServiceKey).mockRejectedValue(
      Object.assign(new Error('Core unreachable'), { status: 503 }),
    );

    const result = await resolveMissingCoreCourses(byId, ['core-1']);

    expect(result.has('core-1')).toBe(false);
    expect(resolveIsPublished({ coreOfferingId: 'core-1' }, result)).toBe(false);
  });
});
