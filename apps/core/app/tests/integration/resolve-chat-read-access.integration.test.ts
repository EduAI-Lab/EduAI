/**
 * PICT adapter (#1186, census docs/PICT_CENSUS.md § S7): per generated row from
 * tests/models/resolve-chat-read-access.cases.json, seeds a real chat +
 * course/enrollment state and calls the real `resolveChatReadAccess` against
 * a real Postgres DB, asserting against
 * tests/models/resolve-chat-read-access.oracle.ts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import prisma from "~/lib/prisma.server";
import { resolveChatReadAccess } from "~/lib/chat-history/server";
import { setPolicy, invalidatePolicyCache } from "~/lib/policy.server";
import { seedUser, seedCourse, enroll, cleanupRbac } from "../helpers/rbac";
import { seedTestDisciplines } from "../helpers/disciplines";
import resolveChatReadAccessCases from "../../../../../tests/models/resolve-chat-read-access.cases.json";
import {
  resolveChatReadAccessOracle,
  type ResolveChatReadAccessRow,
} from "../../../../../tests/models/resolve-chat-read-access.oracle";

const rows = resolveChatReadAccessCases as ResolveChatReadAccessRow[];
const DEPARTMENT = "COSC";

const POLICY_KEY_FOR_LEVEL = {
  instructor: "instructors.canViewCourseChats",
  unit: "unitAdmins.canViewUnitChats",
} as const;

const userIds: string[] = [];
const courseIds: string[] = [];
const chatIds: string[] = [];

beforeAll(async () => {
  await seedTestDisciplines();
});

afterEach(async () => {
  await invalidatePolicyCache();
});

afterAll(async () => {
  // setPolicy persists overrides to SystemConfig (upsert under the `policy.<key>`
  // prefix, per lib/policy.server.ts) — clearing the in-memory cache alone leaves
  // those rows behind for whatever runs against this DB next.
  await prisma.systemConfig.deleteMany({
    where: { key: { in: Object.values(POLICY_KEY_FOR_LEVEL).map((key) => `policy.${key}`) } },
  });
  await invalidatePolicyCache();
  await prisma.chat.deleteMany({ where: { id: { in: chatIds } } });
  await cleanupRbac({ userIds, courseIds });
  await prisma.$disconnect();
});

async function buildRow(row: ResolveChatReadAccessRow) {
  const owner = await seedUser({ role: "STUDENT" });
  userIds.push(owner.id);

  let courseId: string | null = null;
  if (row.CourseId === "present") {
    const course = await seedCourse({ department: DEPARTMENT });
    courseIds.push(course.id);
    courseId = course.id;

    if (row.OwnerActiveStudent === "yes") {
      await enroll(course.id, owner.id, "STUDENT", true);
    }
  }

  const chat = await prisma.chat.create({
    data: { userId: owner.id, courseId },
  });
  chatIds.push(chat.id);

  if (row.AccessLevel === "instructor" || row.AccessLevel === "unit") {
    await setPolicy(
      POLICY_KEY_FOR_LEVEL[row.AccessLevel],
      row.PolicyFlag === "on",
      "pict-test-admin",
    );
  }

  let viewer: { id: string; role: string; authorizedUnits?: string[] };
  if (row.Owner === "yes") {
    viewer = owner;
  } else if (row.Admin === "yes") {
    const admin = await seedUser({ role: "ADMIN" });
    userIds.push(admin.id);
    viewer = admin;
  } else {
    switch (row.AccessLevel) {
      case "unit": {
        const unitAdmin = await seedUser({ role: "UNIT_ADMIN", authorizedUnits: [DEPARTMENT] });
        userIds.push(unitAdmin.id);
        viewer = unitAdmin;
        break;
      }
      case "instructor": {
        const instructor = await seedUser({ role: "INSTRUCTOR" });
        userIds.push(instructor.id);
        if (courseId) await enroll(courseId, instructor.id, "INSTRUCTOR", true);
        viewer = instructor;
        break;
      }
      case "ta": {
        // TA is not a platform role — STUDENT + a TA enrollment (rbac-matrix.md §1).
        const ta = await seedUser({ role: "STUDENT" });
        userIds.push(ta.id);
        if (courseId) await enroll(courseId, ta.id, "TA", true);
        viewer = ta;
        break;
      }
      case "student": {
        const student = await seedUser({ role: "STUDENT" });
        userIds.push(student.id);
        if (courseId) await enroll(courseId, student.id, "STUDENT", true);
        viewer = student;
        break;
      }
      case "none": {
        const bystander = await seedUser({ role: "STUDENT" });
        userIds.push(bystander.id);
        viewer = bystander;
        break;
      }
    }
  }

  return { chat, viewer: viewer! };
}

describe.each(rows.map((row, index) => [index, row] as const))(
  "resolve-chat-read-access PICT row #%i",
  (index, row) => {
    it(
      `${row.Owner}/${row.Admin}/${row.CourseId}/${row.AccessLevel}/${row.PolicyFlag}/${row.OwnerActiveStudent} matches oracle`,
      async () => {
        const expected = resolveChatReadAccessOracle(row);
        const { chat, viewer } = await buildRow(row);

        const result = await resolveChatReadAccess(viewer, chat.id);

        if (expected.outcome === "denied") {
          expect(result).toBeNull();
        } else {
          expect(result).not.toBeNull();
          expect(result!.isOwner).toBe(expected.isOwner);
          expect(result!.canEdit).toBe(expected.isOwner);
        }
      },
    );
  },
);
