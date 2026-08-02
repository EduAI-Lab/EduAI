/**
 * PICT flagship (#1181) — AI Tutor adapter for course-access-across-apps.
 * Exercises GET /courses/:courseId membership against the shared oracle.
 *
 * Known drift vs rbac-matrix §3/§19 (filed, not fixed here):
 *   - Detail membership does not check enrollment isActive.
 *   - Detail membership does not apply the student publish gate.
 * Those rows use it.fails so a future fix flips them to hard failures until
 * the it.fails wrapper is removed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createApp } from '../../src/app.js';
import {
  makeStudent,
  makeAdmin,
  makeUnitAdmin,
  truncateAll,
  seedMinimalCourse,
  prisma,
} from '../helpers.js';

vi.mock('../../src/services/policyService.js', () => ({
  getPolicy: vi.fn().mockResolvedValue(true),
  getPolicies: vi.fn().mockResolvedValue({ 'instructors.canCreateCourses': true }),
  invalidatePolicyCache: vi.fn(),
  __resetPolicyServiceState: vi.fn(),
}));

vi.mock('../../src/services/topicSync.js', () => ({
  syncExternalCourseTopics: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/enrollmentSync.js', () => ({
  AUTO_SYNC_TTL_MS: 30_000,
  AUTO_SYNC_TIMEOUT_MS: 3_000,
  syncCourseEnrollments: vi.fn().mockResolvedValue({
    synced: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    errors: [],
  }),
}));

vi.mock('../../src/services/eduaiClient.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchCoreCourseSafe: vi.fn(),
    listEduAiCourses: vi.fn(),
    listEduAiCoursesServiceKey: vi.fn(),
    findEduAiCourseById: vi.fn(),
  };
});

import { fetchCoreCourseSafe } from '../../src/services/eduaiClient.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../');
const allCases = JSON.parse(
  readFileSync(path.join(repoRoot, 'tests/models/course-access-across-apps.cases.json'), 'utf8'),
);
const {
  courseAccessOracle,
  effectiveEnrollment,
  formatCourseAccessRow,
  platformRoleForRow,
} = await import(path.join(repoRoot, 'tests/models/course-access-across-apps.oracle.ts'));

const rows = allCases.filter((r) => r.App === 'ai-tutor');
const DEPARTMENT = 'COSC';
const OTHER_DEPARTMENT = 'MATH';

/** Rows where AT detail membership diverges from the shared contract. */
function isKnownAtDrift(row, expected) {
  // GET /courses/:id does not apply the student publish gate (rbac-matrix §19).
  return expected.reason === 'unpublished-student';
}

function actualFromStatus(status, levelWhenAllowed) {
  if (status === 404) return { outcome: 'denied', reason: 'no-course' };
  if (status === 403 || status === 401) return { outcome: 'denied', reason: 'no-access' };
  if (status === 200) return { outcome: 'allowed', level: levelWhenAllowed };
  return { outcome: 'denied', reason: 'no-access' };
}

function levelFromEnrollment(row) {
  const enrollment = effectiveEnrollment(row);
  if (row.Role === 'ADMIN') return 'admin';
  if (row.Role === 'UNIT_ADMIN' && row.UnitMatch === 'in-unit') return 'unit';
  if (enrollment === 'active-INSTRUCTOR') return 'instructor';
  if (enrollment === 'active-TA') return 'ta';
  if (enrollment === 'active-STUDENT') return 'student';
  return 'student';
}

beforeEach(async () => {
  await truncateAll();
  vi.mocked(fetchCoreCourseSafe).mockReset();
});

afterEach(async () => {
  await truncateAll();
});

describe.each(rows.map((row, index) => [index, row]))(
  'course-access-across-apps AI Tutor PICT row #%i',
  (index, row) => {
    const expected = courseAccessOracle(row);
    const run = isKnownAtDrift(row, expected) ? it.fails : it;

    run(`${row.Role}/${row.Enrollment}/${row.CourseState}/${row.UnitMatch} matches oracle`, async () => {
      const platformRole = platformRoleForRow(row);

      let user;
      if (platformRole === 'ADMIN') {
        user = makeAdmin();
      } else if (platformRole === 'UNIT_ADMIN') {
        user = makeUnitAdmin([DEPARTMENT]);
      } else {
        user = makeStudent({ role: platformRole });
      }

      let courseId;
      let levelWhenAllowed = levelFromEnrollment(row);

      if (row.CourseState === 'deleted') {
        courseId = 999999;
        vi.mocked(fetchCoreCourseSafe).mockResolvedValue(null);
      } else {
        const seed = await seedMinimalCourse(null);
        courseId = seed.course.id;

        let department = DEPARTMENT;
        if (row.Role === 'UNIT_ADMIN') {
          if (row.UnitMatch === 'null-dept') department = null;
          else if (row.UnitMatch === 'out-of-unit') department = OTHER_DEPARTMENT;
        }

        vi.mocked(fetchCoreCourseSafe).mockResolvedValue({
          id: seed.course.coreOfferingId,
          name: 'PICT Course',
          department,
          isPublished: row.CourseState === 'published',
        });

        const enrollment = effectiveEnrollment(row);
        if (enrollment === 'active-INSTRUCTOR') {
          await prisma.courseEnrollment.create({
            data: { courseOfferingId: courseId, userId: user.id, role: 'INSTRUCTOR' },
          });
        } else if (enrollment === 'active-TA') {
          await prisma.courseEnrollment.create({
            data: { courseOfferingId: courseId, userId: user.id, role: 'TA' },
          });
        } else if (enrollment === 'active-STUDENT') {
          await prisma.courseEnrollment.create({
            data: { courseOfferingId: courseId, userId: user.id, role: 'STUDENT' },
          });
        }
        // Enrollment=inactive: AT CourseEnrollment has no isActive column; omitting
        // the row matches Core's "inactive → no access" after a good sync.
      }

      const app = await createApp({ mockUser: user });
      const res = await request(app).get(`/api/courses/${courseId}`);
      const actual = actualFromStatus(res.status, levelWhenAllowed);

      expect(actual, formatCourseAccessRow(row)).toEqual(expected);
    });
  },
);
