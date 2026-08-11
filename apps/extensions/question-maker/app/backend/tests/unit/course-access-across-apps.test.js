/**
 * PICT flagship (#1181) — Question Maker adapter for course-access-across-apps.
 * shared_course_rbac ∩ app_role_floor against resolveAccessForCourse + QM_AUTHORIZED.
 * Mocks Prisma + Core HTTP (same harness as courseAccess.test.js).
 *
 * App is an adapter parameter — every generated row is replayed here (and in
 * Core / AI Tutor) so shared inputs are identical across apps. QM_AUTHORIZED
 * floor denials (Role=TA|STUDENT) go through production `requireRole(QM_AUTHORIZED)`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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

const { resolveAccessForCourse, resolveCourseAccessWithCourse } = await import(
  '../../src/middleware/courseAccess.js'
);
const { requireRole } = await import('../../src/middleware/auth.js');
const { QM_AUTHORIZED } = await import('../../src/middleware/roles.js');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..');
const allCases = JSON.parse(
  readFileSync(path.join(repoRoot, 'tests/models/course-access-across-apps.cases.json'), 'utf8'),
);

const {
  courseAccessOracle,
  effectiveEnrollment,
  formatCourseAccessRow,
  platformRoleForRow,
} = await import(path.join(repoRoot, 'tests/models/course-access-across-apps.oracle.ts'));

const APP = 'question-maker';
const rows = allCases;

const DEPARTMENT = 'COSC';
const OTHER_DEPARTMENT = 'MATH';
const CORE_ID = 'core-c1';
const QM_COURSE = { id: 1, userId: 'owner-other', coreCourseId: CORE_ID };

function makeRes() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function actualFromQm(opts) {
  if (opts.floorDenied) return { outcome: 'denied', reason: 'app-floor' };
  if (opts.courseMissing) return { outcome: 'denied', reason: 'no-course' };
  if (!opts.access) return { outcome: 'denied', reason: 'no-access' };
  if (opts.access.level === 'student' && opts.unpublished) {
    return { outcome: 'denied', reason: 'unpublished-student' };
  }
  return { outcome: 'allowed', level: opts.access.level };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each(rows.map((row, index) => [index, row]))(
  'course-access-across-apps QM PICT row #%i',
  (index, row) => {
    it(`${row.Role}/${row.Enrollment}/${row.CourseState}/${row.UnitMatch} matches oracle`, async () => {
      const expected = courseAccessOracle(row, APP);
      const platformRole = platformRoleForRow(row, APP);
      const user = {
        id: 'u1',
        role: platformRole,
        authorizedUnits: row.Role === 'UNIT_ADMIN' ? [DEPARTMENT] : undefined,
      };

      // Production app floor: requireRole(QM_AUTHORIZED) before per-course resolve.
      const res = makeRes();
      const next = vi.fn();
      requireRole(QM_AUTHORIZED)({ user }, res, next);
      if (!next.mock.calls.length) {
        expect(res.status).toHaveBeenCalledWith(403);
        const actual = actualFromQm({ floorDenied: true });
        expect(actual, formatCourseAccessRow(row, APP)).toEqual(expected);
        return;
      }

      if (row.CourseState === 'deleted') {
        mockCourseFindOne.mockResolvedValue(null);
        const { course, access } = await resolveCourseAccessWithCourse(user, QM_COURSE.id, {
          cookie: 'c',
        });
        const actual = actualFromQm({ courseMissing: !course, access });
        expect(actual, formatCourseAccessRow(row, APP)).toEqual(expected);
        return;
      }

      mockCourseFindOne.mockResolvedValue(QM_COURSE);

      let department = DEPARTMENT;
      if (row.Role === 'UNIT_ADMIN') {
        if (row.UnitMatch === 'null-dept') department = null;
        else if (row.UnitMatch === 'out-of-unit') department = OTHER_DEPARTMENT;
      }
      mockCourse.mockResolvedValue({ id: CORE_ID, department, isPublished: row.CourseState === 'published' });
      mockMe.mockResolvedValue({ role: 'UNIT_ADMIN', authorizedUnits: [DEPARTMENT] });

      const enrollment = effectiveEnrollment(row);
      const enrollments = [];
      if (enrollment === 'active-INSTRUCTOR') {
        enrollments.push({ studentId: user.id, role: 'INSTRUCTOR', isActive: true });
      } else if (enrollment === 'active-TA') {
        enrollments.push({ studentId: user.id, role: 'TA', isActive: true });
      } else if (enrollment === 'active-STUDENT') {
        enrollments.push({ studentId: user.id, role: 'STUDENT', isActive: true });
      } else if (enrollment === 'inactive') {
        const inactiveRole =
          row.Role === 'INSTRUCTOR' ? 'INSTRUCTOR' : row.Role === 'TA' ? 'TA' : 'STUDENT';
        enrollments.push({ studentId: user.id, role: inactiveRole, isActive: false });
      }
      mockEnrollments.mockResolvedValue({ enrollments });

      const access = await resolveAccessForCourse(user, QM_COURSE, { cookie: 'c' });
      const actual = actualFromQm({
        access,
        unpublished: row.CourseState === 'unpublished',
      });

      expect(actual, formatCourseAccessRow(row, APP)).toEqual(expected);
    });
  },
);
