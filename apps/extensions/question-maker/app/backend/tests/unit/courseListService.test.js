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
      { id: 'core-1', department: 'COSC' },
      { id: 'core-2', department: 'MATH' },
    ]);
  });

  it('returns all courses for ADMIN', async () => {
    mockFindAll.mockResolvedValue([
      { toJSON: () => ({ id: 1, name: 'A', coreCourseId: 'core-1' }) },
      { toJSON: () => ({ id: 2, name: 'B', coreCourseId: 'core-2' }) },
    ]);

    const rows = await listCoursesForUser({ id: 'admin-1', role: 'ADMIN' });
    expect(rows).toHaveLength(2);
    expect(rows[0].accessLevel).toBe('admin');
    expect(rows[0].department).toBe('COSC');
    expect(mockResolveAccess).not.toHaveBeenCalled();
  });

  it('filters courses for INSTRUCTOR by resolveAccessForCourse', async () => {
    const owned = { id: 1, toJSON: () => ({ id: 1, name: 'Mine', coreCourseId: 'core-1' }) };
    const other = { id: 2, toJSON: () => ({ id: 2, name: 'Other', coreCourseId: 'core-2' }) };
    mockFindAll.mockResolvedValue([owned, other]);
    mockResolveAccess.mockImplementation((_user, course) =>
      course.id === 1 ? { level: 'instructor', rank: 2 } : null,
    );

    const rows = await listCoursesForUser({ id: 'inst-1', role: 'INSTRUCTOR' });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
    expect(rows[0].accessLevel).toBe('instructor');
  });
});
