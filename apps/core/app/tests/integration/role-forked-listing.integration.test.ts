/**
 * PICT adapter (#1185, census docs/PICT_CENSUS.md § S6): Core half of the
 * role-forked-listing drift contract. Per row from
 * tests/models/role-forked-listing.cases.json where Site="core", applies the
 * real `buildCourseListFilter` against a real Postgres DB and checks whether
 * the seeded course is included, against
 * tests/models/role-forked-listing.oracle.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import prisma from "~/lib/prisma.server";
import { buildCourseListFilter } from "~/lib/auth/course-access.server";
import { seedUser, seedCourse, enroll, cleanupRbac } from "../helpers/rbac";
import { seedTestDisciplines } from "../helpers/disciplines";
import roleForkedListingCases from "../../../../../tests/models/role-forked-listing.cases.json";
import {
  courseVisibleOracle,
  type RoleForkedListingRow,
} from "../../../../../tests/models/role-forked-listing.oracle";

const rows = (roleForkedListingCases as RoleForkedListingRow[]).filter((r) => r.Site === "core");
const DEPARTMENT = "COSC";
const OTHER_DEPARTMENT = "MATH";

const userIds: string[] = [];
const courseIds: string[] = [];

beforeAll(async () => {
  await seedTestDisciplines();
});

afterAll(async () => {
  await cleanupRbac({ userIds, courseIds });
  await prisma.$disconnect();
});

describe.each(rows.map((row, index) => [index, row] as const))(
  "role-forked-listing Core PICT row #%i",
  (index, row) => {
    it(
      `${row.PlatformRole}/${row.Enrollment}/${row.Published}/${row.UnitMatch} matches oracle`,
      async () => {
        const expected = courseVisibleOracle(row);

        const course = await seedCourse({
          department: DEPARTMENT,
          isPublished: row.Published === "yes",
        });
        courseIds.push(course.id);

        const authorizedUnits =
          row.PlatformRole === "UNIT_ADMIN"
            ? [row.UnitMatch === "in-unit" ? DEPARTMENT : OTHER_DEPARTMENT]
            : [];
        const viewer = await seedUser({ role: row.PlatformRole, authorizedUnits });
        userIds.push(viewer.id);

        if (row.Enrollment !== "none") {
          const enrollmentRole =
            row.Enrollment === "student" ? "STUDENT" : row.Enrollment === "ta" ? "TA" : "INSTRUCTOR";
          await enroll(course.id, viewer.id, enrollmentRole, true);
        }

        const filter = await buildCourseListFilter(viewer);
        const visibleCourses = await prisma.course.findMany({
          where: filter,
          select: { id: true },
        });
        const visible = visibleCourses.some((c) => c.id === course.id);

        expect(visible).toBe(expected);
      },
    );
  },
);
