/**
 * Unit tests for role-scoped QM course listing.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockFindAll = vi.fn();
const mockResolveAccess = vi.fn();
const mockGetAllCoursesFromCore = vi.fn();

vi.mock('../../src/schema/index.js', () => ({
  Course: { findAll: (...args) => mockFindAll(...args) },
}));

vi.mock('../../src/middleware/courseAccess.js', () => ({
  LEVELS: {
    admin: { level: 'admin', rank: 4 },
    unit: { level: 'unit', rank: 3 },
    instructor: { level: 'instructor', rank: 2 },
    ta: { level: 'ta', rank: 1 },
  },
  resolveAccessForCourse: (...args) => mockResolveAccess(...args),
}));

vi.mock('../../src/services/coreApiService.js', () => ({
  getAllCoursesFromCore: (...args) => mockGetAllCoursesFromCore(...args),
}));

const { listCoursesForUser } = await import('../../src/services/courseListService.js');

describe('listCoursesForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllCoursesFromCore.mockResolvedValue([
      { id: 'core-1', name: 'Core Course One', code: 'STUDY3', department: 'COSC' },
      { id: 'core-2', name: 'Core Course Two', code: 'MATH100', department: 'MATH' },
    ]);
  });

  it('returns all courses for ADMIN', async () => {
    mockFindAll.mockResolvedValue([
      { toJSON: () => ({ id: 1, name: 'A', code: 'stale-a', coreCourseId: 'core-1' }) },
      { toJSON: () => ({ id: 2, name: 'B', code: 'stale-b', coreCourseId: 'core-1' }) },
    ]);

    const rows = await listCoursesForUser({ id: 'admin-1', role: 'ADMIN' });
    // Both local rows link to the same Core course (core-1) — name/code now come
    // from Core (#1076), so they dedupe to one row on Core's code, not the stale
    // local codes that previously differed.
    expect(rows).toHaveLength(1);
    expect(rows[0].accessLevel).toBe('admin');
    expect(rows[0].department).toBe('COSC');
    expect(rows[0].name).toBe('Core Course One');
    expect(rows[0].code).toBe('STUDY3');
    expect(mockResolveAccess).not.toHaveBeenCalled();
  });

  it('filters courses for INSTRUCTOR by resolveAccessForCourse', async () => {
    const owned = { id: 1, toJSON: () => ({ id: 1, name: 'Mine', code: 'stale', coreCourseId: 'core-1' }) };
    const other = { id: 2, toJSON: () => ({ id: 2, name: 'Other', code: 'stale', coreCourseId: 'core-2' }) };
    mockFindAll.mockResolvedValue([owned, other]);
    mockResolveAccess.mockImplementation((_user, course) =>
      course.id === 1 ? { level: 'instructor', rank: 2 } : null,
    );

    const rows = await listCoursesForUser({ id: 'inst-1', role: 'INSTRUCTOR' });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
    expect(rows[0].accessLevel).toBe('instructor');
    // Name/code are read through from Core, not the stale local columns (#1076).
    expect(rows[0].name).toBe('Core Course One');
    expect(rows[0].code).toBe('STUDY3');
  });

  it('degrades to a placeholder (not the stale local value) when Core is unreachable', async () => {
    mockGetAllCoursesFromCore.mockRejectedValue(new Error('Core unavailable'));
    mockFindAll.mockResolvedValue([
      { toJSON: () => ({ id: 1, name: 'Stale Local Name', code: 'STALE101', coreCourseId: 'core-1' }) },
    ]);

    const rows = await listCoursesForUser({ id: 'admin-1', role: 'ADMIN' });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Course unavailable');
    expect(rows[0].code).toBeNull();
    expect(rows[0].coreUnavailable).toBe(true);
  });

  it('keeps local name/code for a course not yet linked to Core', async () => {
    mockFindAll.mockResolvedValue([
      { toJSON: () => ({ id: 1, name: 'Sandbox Course', code: 'SANDBOX', coreCourseId: null }) },
    ]);

    const rows = await listCoursesForUser({ id: 'admin-1', role: 'ADMIN' });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Sandbox Course');
    expect(rows[0].code).toBe('SANDBOX');
    expect(rows[0].coreUnavailable).toBe(false);
  });
});
