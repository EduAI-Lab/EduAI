// @vitest-environment node
//
// PICT flagship drift contract (#1181, census docs/PICT_CENSUS.md § S2):
// shared_course_rbac ∩ app_role_floor, Core adapter. One oracle
// (tests/models/course-access-across-apps.oracle.ts), committed rows from
// `npm run test:pict:gen`, world-builder here via helpers/rbac.ts.
//
// Invokes production resolveCourseAccessWithCourse, then the student publish
// gate that callers apply outside the resolver (rbac-matrix.md §3 / §19).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import prisma from "~/lib/prisma.server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import { seedUser, seedCourse, enroll, cleanupRbac } from "../helpers/rbac";
import { seedTestDisciplines } from "../helpers/disciplines";
import courseAccessCases from "../../../../../tests/models/course-access-across-apps.cases.json";
import {
  courseAccessOracle,
  effectiveEnrollment,
  formatCourseAccessRow,
  platformRoleForRow,
  type AccessLevelName,
  type CourseAccessRow,
  type CourseAccessVerdict,
} from "../../../../../tests/models/course-access-across-apps.oracle";

const DEPARTMENT = "COSC";
const OTHER_DEPARTMENT = "MATH";

const rows = (courseAccessCases as CourseAccessRow[]).filter((r) => r.App === "core");

const seededUserIds: string[] = [];
const seededCourseIds: string[] = [];

type ActualVerdict = CourseAccessVerdict;

function actualFromResolve(opts: {
  course: { isPublished: boolean } | null;
  access: { level: AccessLevelName } | null;
}): ActualVerdict {
  if (!opts.course) return { outcome: "denied", reason: "no-course" };
  if (!opts.access) return { outcome: "denied", reason: "no-access" };
  if (opts.access.level === "student" && !opts.course.isPublished) {
    return { outcome: "denied", reason: "unpublished-student" };
  }
  return { outcome: "allowed", level: opts.access.level };
}

async function buildRow(row: CourseAccessRow) {
  const deletedAt = row.CourseState === "deleted" ? new Date() : null;
  const isPublished = row.CourseState === "published";

  let department: string | null = DEPARTMENT;
  if (row.Role === "UNIT_ADMIN") {
    if (row.UnitMatch === "null-dept") department = null;
    else if (row.UnitMatch === "out-of-unit") department = OTHER_DEPARTMENT;
    else department = DEPARTMENT;
  }

  const course = await seedCourse({
    department,
    isPublished,
    deletedAt,
  });
  seededCourseIds.push(course.id);

  const platformRole = platformRoleForRow(row);
  const authorizedUnits =
    row.Role === "UNIT_ADMIN"
      ? row.UnitMatch === "out-of-unit"
        ? [DEPARTMENT] // user authorized for COSC; course is MATH
        : [DEPARTMENT]
      : [];

  const user = await seedUser({
    role: platformRole,
    authorizedUnits,
  });
  seededUserIds.push(user.id);

  const enrollment = effectiveEnrollment(row);
  if (enrollment === "active-INSTRUCTOR") {
    await enroll(course.id, user.id, "INSTRUCTOR", true);
  } else if (enrollment === "active-TA") {
    await enroll(course.id, user.id, "TA", true);
  } else if (enrollment === "active-STUDENT") {
    await enroll(course.id, user.id, "STUDENT", true);
  } else if (enrollment === "inactive") {
    // Seed an inactive row matching the Role's typical enrollment when constrained.
    const inactiveRole =
      row.Role === "INSTRUCTOR" ? "INSTRUCTOR" : row.Role === "TA" ? "TA" : "STUDENT";
    await enroll(course.id, user.id, inactiveRole, false);
  }

  return { courseId: course.id, user };
}

beforeAll(async () => {
  await seedTestDisciplines();
});

afterAll(async () => {
  await cleanupRbac({ userIds: seededUserIds, courseIds: seededCourseIds });
  await prisma.$disconnect();
});

describe.each(rows.map((row, index) => ({ row, index })))(
  "course-access-across-apps Core PICT row #$index $row.Role/$row.Enrollment/$row.CourseState/$row.UnitMatch/$row.TaWidening",
  ({ row }) => {
    it(`matches the oracle verdict`, async () => {
      const expected = courseAccessOracle(row);
      const seeded = await buildRow(row);
      const { course, access } = await resolveCourseAccessWithCourse(seeded.user, seeded.courseId);
      const actual = actualFromResolve({
        course,
        access: access ? { level: access.level } : null,
      });

      expect(actual, formatCourseAccessRow(row)).toEqual(expected);
    });
  },
);
