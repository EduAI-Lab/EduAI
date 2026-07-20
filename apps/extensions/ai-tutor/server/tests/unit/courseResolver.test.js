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
  resolveCoreCourseCatalog,
  resolveCoreCourseList,
  resolveIsPublished,
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
    expect(listEduAiCourses).toHaveBeenCalledWith({ cookie: 'session=abc', all: true });
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

// Unified contract (#1072): the service-key catalog is the single field
// source for list flows. It contains every non-deleted Core course
// regardless of the caller's Core enrollment, so the #1082 class of bug
// (AT-only-enrolled caller's course invisible because the cookie-scoped
// list omitted it) is impossible by construction — locked in below.
describe('resolveCoreCourseCatalog', () => {
  it('returns the full catalog and coreUnavailable:false on success', async () => {
    const catalog = [{ id: 'c1', isPublished: true }, { id: 'c2', isPublished: false }];
    vi.mocked(listEduAiCoursesServiceKey).mockResolvedValue(catalog);

    const result = await resolveCoreCourseCatalog();

    expect(result).toEqual({ courses: catalog, coreUnavailable: false });
    expect(listEduAiCoursesServiceKey).toHaveBeenCalledTimes(1);
    // Field truth never touches the cookie-scoped list.
    expect(listEduAiCourses).not.toHaveBeenCalled();
  });

  it('#1082 by construction: an AT-only-enrolled caller\'s published course resolves from the catalog', async () => {
    // The catalog is enrollment-independent — the course is present even
    // though no cookie-scoped list would have contained it for this caller.
    vi.mocked(listEduAiCoursesServiceKey).mockResolvedValue([
      { id: 'core-at-only', isPublished: true },
    ]);

    const { courses } = await resolveCoreCourseCatalog();
    const byId = indexCoreCoursesById(courses);

    expect(resolveIsPublished({ coreOfferingId: 'core-at-only' }, byId)).toBe(true);
  });

  it('one batched call regardless of catalog size — never per-course', async () => {
    vi.mocked(listEduAiCoursesServiceKey).mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => ({ id: `c${i}` })),
    );

    await resolveCoreCourseCatalog();

    expect(listEduAiCoursesServiceKey).toHaveBeenCalledTimes(1);
  });

  it('degrades to empty + coreUnavailable:true on a thrown error (Core down / missing service key)', async () => {
    vi.mocked(listEduAiCoursesServiceKey).mockRejectedValue(
      Object.assign(new Error('Core unreachable'), { status: 503 }),
    );

    const result = await resolveCoreCourseCatalog();

    expect(result).toEqual({ courses: [], coreUnavailable: true });
    // Publish gates keyed off the empty map fail closed.
    expect(resolveIsPublished({ coreOfferingId: 'core-1' }, indexCoreCoursesById(result.courses))).toBe(false);
  });

  it('a course absent from the catalog (deleted in Core) stays unresolved and fails closed', async () => {
    vi.mocked(listEduAiCoursesServiceKey).mockResolvedValue([{ id: 'core-unrelated', isPublished: true }]);

    const { courses } = await resolveCoreCourseCatalog();
    const byId = indexCoreCoursesById(courses);

    expect(byId.has('core-deleted-or-unknown')).toBe(false);
    expect(resolveIsPublished({ coreOfferingId: 'core-deleted-or-unknown' }, byId)).toBe(false);
  });

  it('treats a non-array resolved value as empty', async () => {
    vi.mocked(listEduAiCoursesServiceKey).mockResolvedValue(undefined);

    const result = await resolveCoreCourseCatalog();

    expect(result).toEqual({ courses: [], coreUnavailable: false });
  });
});
