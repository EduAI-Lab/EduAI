/**
 * PICT adapter (#1185, census docs/PICT_CENSUS.md § S6): ai-tutor half of the
 * role-forked-listing drift contract. Per row from
 * tests/models/role-forked-listing.cases.json where Site="ai-tutor", drives
 * GET /courses against a real local DB (Core catalog mocked at the
 * eduaiClient boundary) and checks whether the seeded course is included,
 * against tests/models/role-forked-listing.oracle.ts.
 *
 * #1386: a PlatformRole STUDENT holding an Enrollment=instructor row (a
 * CourseInstructor row here) used to be visible in Core's listing
 * (enrollment-role keyed, rbac-matrix.md §3) but NOT in ai-tutor's, whose
 * INSTRUCTOR branch was platform-role gated instead. Fixed by having
 * ai-tutor's STUDENT fork also honor a CourseInstructor row (any publish
 * state, TA-parity) — courseVisibleAiTutor now predicts `true` for this row
 * too, matching Core's counterpart row for the same (PlatformRole,
 * Enrollment) pair.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createApp } from '../../src/app.js';
import { makeStudent, makeAdmin, makeUnitAdmin, makeProfessor, truncateAll, prisma } from '../helpers.js';

vi.mock('../../src/services/policyService.js', () => ({
  getPolicy: vi.fn().mockResolvedValue(true),
  getPolicies: vi.fn().mockResolvedValue({ 'instructors.canCreateCourses': true }),
  invalidatePolicyCache: vi.fn(),
  __resetPolicyServiceState: vi.fn(),
}));

vi.mock('../../src/services/importTaughtCoursesService.js', () => ({
  runCoreMirror: vi.fn(),
  ensureOfferingAnchors: vi.fn().mockResolvedValue(undefined),
  importExternalCourseForUser: vi.fn(),
}));

vi.mock('../../src/services/eduaiClient.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listEduAiCoursesServiceKey: vi.fn(),
    listEduAiCourses: vi.fn(),
    findEduAiCourseById: vi.fn(),
  };
});

import { listEduAiCoursesServiceKey } from '../../src/services/eduaiClient.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../');
const allCases = JSON.parse(
  readFileSync(path.join(repoRoot, 'tests/models/role-forked-listing.cases.json'), 'utf8'),
);
const { courseVisibleOracle } = await import(
  path.join(repoRoot, 'tests/models/role-forked-listing.oracle.ts')
);

const rows = allCases.filter((r) => r.Site === 'ai-tutor');
const DEPARTMENT = 'COSC';
const OTHER_DEPARTMENT = 'MATH';

beforeEach(async () => {
  await truncateAll();
  vi.mocked(listEduAiCoursesServiceKey).mockReset();
});

afterEach(async () => {
  await truncateAll();
});

describe.each(rows.map((row, index) => [index, row]))(
  'role-forked-listing AI Tutor PICT row #%i',
  (index, row) => {
    const expected = courseVisibleOracle(row);

    it(`${row.PlatformRole}/${row.Enrollment}/${row.Published}/${row.UnitMatch} matches oracle`, async () => {
      const course = await prisma.courseOffering.create({ data: { coreOfferingId: `core-${index}` } });

      const department = row.UnitMatch === 'in-unit' ? DEPARTMENT : OTHER_DEPARTMENT;
      vi.mocked(listEduAiCoursesServiceKey).mockResolvedValue([
        { id: course.coreOfferingId, name: 'PICT Course', department: DEPARTMENT, isPublished: row.Published === 'yes' },
      ]);

      let user;
      if (row.PlatformRole === 'ADMIN') user = makeAdmin();
      else if (row.PlatformRole === 'UNIT_ADMIN') user = makeUnitAdmin([department]);
      else if (row.PlatformRole === 'INSTRUCTOR') user = makeProfessor();
      else user = makeStudent();

      if (row.Enrollment === 'instructor') {
        // ai-tutor's instructor-of-record relation is CourseInstructor, not CourseEnrollment.
        await prisma.courseInstructor.create({
          data: { courseOfferingId: course.id, userId: user.id, role: 'LEAD' },
        });
      } else if (row.Enrollment !== 'none') {
        await prisma.courseEnrollment.create({
          data: {
            courseOfferingId: course.id,
            userId: user.id,
            role: row.Enrollment === 'student' ? 'STUDENT' : 'TA',
          },
        });
      }

      const app = await createApp({ mockUser: user });
      const res = await request(app).get('/api/courses').query({ page: 1, pageSize: 50 });

      expect(res.status).toBe(200);
      const visible = res.body.data.some((c) => c.id === course.id);
      expect(visible, JSON.stringify({ row, body: res.body })).toBe(expected);
    });
  },
);
