/**
 * Unit tests for QM per-course RBAC (resolveCourseAccess + requireCourseAccess).
 * Mocks the Course model and the Core HTTP client — no network or DB needed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCourseFindOne, mockEnrollments, mockCourse, mockMe } = vi.hoisted(() => ({
  mockCourseFindOne: vi.fn(),
  mockEnrollments: vi.fn(),
  mockCourse: vi.fn(),
  mockMe: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  prisma: { course: { findUnique: mockCourseFindOne } },
}));

vi.mock('../../src/services/coreApiService.js', () => ({
  getCourseEnrollmentsFromCore: mockEnrollments,
  getCourseFromCore: mockCourse,
  getMyProfileFromCore: mockMe,
}));

const { resolveCourseAccess, requireCourseAccess, LEVELS } = await import(
  '../../src/middleware/courseAccess.js'
);

const LINKED = { id: 1, userId: 'owner-1', coreCourseId: 'core-c1' };

beforeEach(() => {
  vi.clearAllMocks();
  mockCourseFindOne.mockResolvedValue(LINKED);
  mockEnrollments.mockResolvedValue({ enrollments: [] });
  mockCourse.mockResolvedValue({ id: 'core-c1', department: 'COSC' });
  mockMe.mockResolvedValue({ role: 'UNIT_ADMIN', authorizedUnits: [] });
});

describe('resolveCourseAccess', () => {
  it('grants ADMIN the admin level without any Core call', async () => {
    const access = await resolveCourseAccess({ id: 'a', role: 'ADMIN' }, 1);
    expect(access).toEqual(LEVELS.admin);
    expect(mockEnrollments).not.toHaveBeenCalled();
    expect(mockCourse).not.toHaveBeenCalled();
  });

  it('returns null when the QM course does not exist', async () => {
    mockCourseFindOne.mockResolvedValueOnce(null);
    const access = await resolveCourseAccess({ id: 'x', role: 'INSTRUCTOR' }, 99);
    expect(access).toBeNull();
  });

  it('returns null for a non-integer course id', async () => {
    const access = await resolveCourseAccess({ id: 'x', role: 'INSTRUCTOR' }, 'abc');
    expect(access).toBeNull();
    expect(mockCourseFindOne).not.toHaveBeenCalled();
  });

  describe('unlinked course (coreCourseId === null)', () => {
    beforeEach(() => {
      mockCourseFindOne.mockResolvedValue({ id: 2, userId: 'owner-1', coreCourseId: null });
    });

    it('grants the owner instructor access', async () => {
      const access = await resolveCourseAccess({ id: 'owner-1', role: 'INSTRUCTOR' }, 2);
      expect(access).toEqual(LEVELS.instructor);
      expect(mockEnrollments).not.toHaveBeenCalled();
    });

    it('denies a non-owner (even a TA enrolled elsewhere)', async () => {
      const access = await resolveCourseAccess({ id: 'someone-else', role: 'TA' }, 2);
      expect(access).toBeNull();
    });
  });

  describe('enrollment-based access', () => {
    it.each([
      ['INSTRUCTOR', LEVELS.instructor],
      ['TA', LEVELS.ta],
      ['STUDENT', LEVELS.student],
    ])('maps an active %s enrollment to its level', async (role, expected) => {
      mockEnrollments.mockResolvedValueOnce({
        enrollments: [{ studentId: 'u1', role, isActive: true }],
      });
      const access = await resolveCourseAccess({ id: 'u1', role: 'STUDENT' }, 1);
      expect(access).toEqual(expected);
    });

    it('returns null when the caller has no enrollment', async () => {
      mockEnrollments.mockResolvedValueOnce({
        enrollments: [{ studentId: 'other', role: 'INSTRUCTOR', isActive: true }],
      });
      const access = await resolveCourseAccess({ id: 'u1', role: 'INSTRUCTOR' }, 1);
      expect(access).toBeNull();
    });

    it('ignores an inactive enrollment', async () => {
      mockEnrollments.mockResolvedValueOnce({
        enrollments: [{ studentId: 'u1', role: 'INSTRUCTOR', isActive: false }],
      });
      const access = await resolveCourseAccess({ id: 'u1', role: 'INSTRUCTOR' }, 1);
      expect(access).toBeNull();
    });

    it('returns null for an unrecognized enrollment role', async () => {
      mockEnrollments.mockResolvedValueOnce({
        enrollments: [{ studentId: 'u1', role: 'OBSERVER', isActive: true }],
      });
      const access = await resolveCourseAccess({ id: 'u1', role: 'STUDENT' }, 1);
      expect(access).toBeNull();
    });
  });

  describe('UNIT_ADMIN unit lock', () => {
    const unitAdmin = { id: 'ua', role: 'UNIT_ADMIN' };

    it('grants unit access when the course department is in authorizedUnits', async () => {
      mockCourse.mockResolvedValueOnce({ id: 'core-c1', department: 'COSC' });
      mockMe.mockResolvedValueOnce({ authorizedUnits: ['COSC', 'MATH'] });
      const access = await resolveCourseAccess(unitAdmin, 1);
      expect(access).toEqual(LEVELS.unit);
      expect(mockEnrollments).not.toHaveBeenCalled();
    });

    it('never matches a null department, falling through to enrollment', async () => {
      mockCourse.mockResolvedValueOnce({ id: 'core-c1', department: null });
      mockMe.mockResolvedValueOnce({ authorizedUnits: ['COSC'] });
      mockEnrollments.mockResolvedValueOnce({ enrollments: [] });
      const access = await resolveCourseAccess(unitAdmin, 1);
      expect(access).toBeNull();
    });

    it('falls through to enrollment when the department is outside their units', async () => {
      mockCourse.mockResolvedValueOnce({ id: 'core-c1', department: 'MATH' });
      mockMe.mockResolvedValueOnce({ authorizedUnits: ['COSC'] });
      mockEnrollments.mockResolvedValueOnce({
        enrollments: [{ studentId: 'ua', role: 'TA', isActive: true }],
      });
      const access = await resolveCourseAccess(unitAdmin, 1);
      expect(access).toEqual(LEVELS.ta);
    });

    it('uses authorizedUnits already on req.user without calling /api/me', async () => {
      mockCourse.mockResolvedValueOnce({ id: 'core-c1', department: 'COSC' });
      const access = await resolveCourseAccess(
        { id: 'ua', role: 'UNIT_ADMIN', authorizedUnits: ['COSC'] },
        1,
      );
      expect(access).toEqual(LEVELS.unit);
      expect(mockMe).not.toHaveBeenCalled();
    });
  });
});

describe('requireCourseAccess', () => {
  function makeRes() {
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    return res;
  }

  const reqBase = { user: { id: 'u1', role: 'INSTRUCTOR' }, headers: {} };

  it('admits and attaches courseAccess + qmCourse when rank meets min', async () => {
    mockEnrollments.mockResolvedValueOnce({
      enrollments: [{ studentId: 'u1', role: 'INSTRUCTOR', isActive: true }],
    });
    const req = { ...reqBase };
    const res = makeRes();
    const next = vi.fn();

    await requireCourseAccess({ min: 'instructor', getCourseId: () => 1 })(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.courseAccess).toEqual(LEVELS.instructor);
    expect(req.qmCourse).toEqual(LINKED);
  });

  it('403s when the caller is below the required rank', async () => {
    mockEnrollments.mockResolvedValueOnce({
      enrollments: [{ studentId: 'u1', role: 'TA', isActive: true }],
    });
    const res = makeRes();
    const next = vi.fn();

    await requireCourseAccess({ min: 'instructor', getCourseId: () => 1 })(
      { user: { id: 'u1', role: 'TA' }, headers: {} },
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('admits a TA when min is ta', async () => {
    mockEnrollments.mockResolvedValueOnce({
      enrollments: [{ studentId: 'u1', role: 'TA', isActive: true }],
    });
    const next = vi.fn();
    await requireCourseAccess({ min: 'ta', getCourseId: () => 1 })(
      { user: { id: 'u1', role: 'TA' }, headers: {} },
      makeRes(),
      next,
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('404s when getCourseId returns null', async () => {
    const res = makeRes();
    const next = vi.fn();
    await requireCourseAccess({ min: 'ta', getCourseId: () => null })(reqBase, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('404s when the course does not exist', async () => {
    mockCourseFindOne.mockResolvedValueOnce(null);
    const res = makeRes();
    const next = vi.fn();
    await requireCourseAccess({ min: 'ta', getCourseId: () => 7 })(reqBase, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('401s when req.user is absent', async () => {
    const res = makeRes();
    const next = vi.fn();
    await requireCourseAccess({ min: 'ta', getCourseId: () => 1 })({ headers: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('forwards thrown errors to next', async () => {
    const boom = new Error('boom');
    const next = vi.fn();
    await requireCourseAccess({
      min: 'ta',
      getCourseId: () => {
        throw boom;
      },
    })(reqBase, makeRes(), next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});
