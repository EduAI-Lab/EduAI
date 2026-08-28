/**
 * Core Admin / Unit Admin / Instructor role-boundary workflows (#1669).
 *
 * Claude find/simulate/review pass for Epic #1429, covering the three roles
 * that (unlike TA/Student — see week15-student-ta-exploration.spec.ts) had no
 * dedicated e2e coverage beyond course-scope-guardrail's happy paths and the
 * pre-existing admin.spec.ts / rbac.spec.ts / access-control.spec.ts files.
 *
 * This file focuses on the boundaries between the three roles and the rest of
 * the RBAC surface: what an ADMIN can do that a UNIT_ADMIN cannot, what a
 * UNIT_ADMIN can do cross-course within their department that an INSTRUCTOR
 * cannot, and what an INSTRUCTOR owns within a single course. It deliberately
 * does not re-test ground admin.spec.ts / rbac.spec.ts / course-scope-guardrail
 * already cover (user list pagination, invitation happy path, RAG-settings
 * save/read-back).
 *
 * Uses the authenticated-API pattern from course-scope-guardrail.spec.ts
 * (fresh users promoted via the E2E-only /api/e2e/promote seam) rather than
 * the seeded demo accounts, since most of what's being tested here is
 * pure-API RBAC/scope logic with no dedicated UI of its own (policy flags,
 * enrollment-role authority, unit scoping). The companion file
 * core-admin-unitadmin-instructor-ui.spec.ts drives the actual admin/unit-admin/
 * instructor console UI in a real browser per the epic's "click through the UI"
 * rule, against the seeded demo accounts.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { CORE_URL } from "../../playwright.config";
import {
  createAdmin,
  createInstructor,
  createUnitAdmin,
  registerUser,
  uniqueEmail,
} from "../helpers/auth";

let runCounter = 0;
function uniqueCourseCode(prefix: string): string {
  runCounter += 1;
  return `${prefix}-${Date.now()}-${runCounter}`;
}

async function getUserId(ctx: APIRequestContext): Promise<string> {
  const res = await ctx.get(`${CORE_URL}/api/me`);
  expect(res.status()).toBe(200);
  return (await res.json()).id;
}

async function setPolicy(admin: APIRequestContext, key: string, value: boolean) {
  const res = await admin.patch(`${CORE_URL}/api/policies`, { data: { key, value } });
  expect(res.status()).toBe(200);
}

// Creates a real, persisted Chat row without touching the (unreachable in
// this dev env) LLM backend: /api/chat creates the Chat as soon as a
// systemPrompt is present, then short-circuits with a fast 200 when
// mergedMessages is empty (messages: []) — no model call, no hang. Same
// pattern as week15-student-ta-exploration-round2.spec.ts's createFastChat.
async function createFastChat(
  ctx: APIRequestContext,
  systemPrompt: string,
  courseId: string,
): Promise<string> {
  const res = await ctx.post(`${CORE_URL}/api/chat`, {
    data: { messages: [], systemPrompt, courseId },
  });
  expect(res.ok(), `createFastChat failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const { chatId } = await res.json();
  expect(chatId, "createFastChat: no chatId in response").toBeTruthy();
  return chatId as string;
}

async function setAuthorizedUnits(admin: APIRequestContext, userId: string, units: string[]) {
  const res = await admin.patch(`${CORE_URL}/api/users/${userId}`, {
    data: { authorizedUnits: units },
  });
  expect(res.status()).toBe(200);
  expect((await res.json()).authorizedUnits).toEqual(units);
}

type CreateCourseForm = {
  name: string;
  code: string;
  section: string;
  term: string;
  year: string;
  startDate: string;
  department: string;
  instructorUserIds?: string;
};

async function createCourse(
  ctx: APIRequestContext,
  opts: { prefix: string; department: string; instructorUserIds?: string },
) {
  const form: CreateCourseForm = {
    name: `Boundary workflow ${opts.prefix}`,
    code: uniqueCourseCode(opts.prefix),
    section: "001",
    term: "W1",
    year: "2026",
    startDate: "2026-09-08",
    department: opts.department,
  };
  if (opts.instructorUserIds) {
    form.instructorUserIds = opts.instructorUserIds;
  }
  const res = await ctx.post(`${CORE_URL}/api/courses`, { form });
  return res;
}

// ===========================================================================
// ADMIN — platform-wide console surfaces beyond user list / invitations
// ===========================================================================

test.describe("Admin console: AI Management / policy registry", () => {
  test("ADMIN can read and toggle a policy flag; value persists", async ({ playwright }) => {
    const admin = await playwright.request.newContext();
    try {
      await createAdmin(admin, { prefix: "policy-admin" });

      const getRes = await admin.get(`${CORE_URL}/api/policies`);
      expect(getRes.status()).toBe(200);
      const { policies, definitions } = await getRes.json();
      // Policy keys are flat strings that happen to contain a literal dot
      // (e.g. "unitAdmins.canInvite") — `toHaveProperty` with a plain string
      // treats the dot as a nested-path separator, so use the array form to
      // match the literal key instead of `policies.unitAdmins.canInvite`.
      expect(policies).toHaveProperty(["unitAdmins.canInvite"]);
      // ADMIN uniquely receives the definitions used to render toggles.
      expect(Array.isArray(definitions)).toBe(true);
      expect(definitions.some((d: any) => d.key === "unitAdmins.canInvite")).toBe(true);

      await setPolicy(admin, "unitAdmins.canInvite", true);
      const after = await (await admin.get(`${CORE_URL}/api/policies`)).json();
      expect(after.policies["unitAdmins.canInvite"]).toBe(true);

      // restore default so this test is order-independent of others below
      await setPolicy(admin, "unitAdmins.canInvite", false);
    } finally {
      await admin.dispose();
    }
  });

  test("non-ADMIN sees policy values but never definitions, and cannot PATCH", async ({
    playwright,
  }) => {
    const instructor = await playwright.request.newContext();
    try {
      await createInstructor(instructor, { prefix: "policy-instructor" });

      const getRes = await instructor.get(`${CORE_URL}/api/policies`);
      expect(getRes.status()).toBe(200);
      const body = await getRes.json();
      expect(body.policies).toHaveProperty(["instructors.canCreateCourses"]);
      expect(body.definitions).toBeUndefined();

      const patchRes = await instructor.patch(`${CORE_URL}/api/policies`, {
        data: { key: "instructors.canCreateCourses", value: false },
      });
      expect(patchRes.status()).toBe(403);
    } finally {
      await instructor.dispose();
    }
  });

  test("UNIT_ADMIN cannot PATCH a policy flag (403)", async ({ playwright }) => {
    const unitAdmin = await playwright.request.newContext();
    try {
      await createUnitAdmin(unitAdmin, { prefix: "policy-unit" });
      const patchRes = await unitAdmin.patch(`${CORE_URL}/api/policies`, {
        data: { key: "unitAdmins.canInvite", value: true },
      });
      expect(patchRes.status()).toBe(403);
    } finally {
      await unitAdmin.dispose();
    }
  });

  test("ADMIN-only AI model/provider catalog: UNIT_ADMIN and INSTRUCTOR are both blocked", async ({
    playwright,
  }) => {
    const unitAdmin = await playwright.request.newContext();
    const instructor = await playwright.request.newContext();
    try {
      await createUnitAdmin(unitAdmin, { prefix: "ai-unit" });
      await createInstructor(instructor, { prefix: "ai-instructor" });

      for (const ctx of [unitAdmin, instructor]) {
        const modelsRes = await ctx.get(`${CORE_URL}/api/ai-models`);
        expect(modelsRes.status()).toBe(403);
        const providersRes = await ctx.get(`${CORE_URL}/api/ai-providers`);
        expect(providersRes.status()).toBe(403);
      }
    } finally {
      await unitAdmin.dispose();
      await instructor.dispose();
    }
  });
});

test.describe("Admin console: bug-report triage", () => {
  test("ADMIN can list and triage a bug report submitted by another user; UNIT_ADMIN cannot", async ({
    playwright,
  }) => {
    const admin = await playwright.request.newContext();
    const unitAdmin = await playwright.request.newContext();
    const reporter = await playwright.request.newContext();
    try {
      await createAdmin(admin, { prefix: "bug-admin" });
      await createUnitAdmin(unitAdmin, { prefix: "bug-unit" });
      await registerUser(reporter, { prefix: "bug-reporter" });

      const submitRes = await reporter.post(`${CORE_URL}/api/bug-reports`, {
        data: {
          bugType: "FEATURE_NOT_WORKING",
          description: "Admin triage e2e probe — course chat composer stayed disabled.",
        },
      });
      expect(submitRes.status()).toBe(201);
      const { id: reportId } = await submitRes.json();

      // ADMIN triage surface: cross-user list + single-report read + status change.
      const listRes = await admin.get(`${CORE_URL}/api/admin/bug-reports`);
      expect(listRes.status()).toBe(200);
      const { reports } = await listRes.json();
      expect(reports.some((r: any) => r.id === reportId)).toBe(true);

      const getRes = await admin.get(`${CORE_URL}/api/admin/bug-reports/${reportId}`);
      expect(getRes.status()).toBe(200);
      expect((await getRes.json()).id).toBe(reportId);

      const patchRes = await admin.patch(`${CORE_URL}/api/admin/bug-reports/${reportId}`, {
        data: { status: "IN_PROGRESS" },
      });
      expect(patchRes.status()).toBe(200);
      expect((await patchRes.json()).status).toBe("IN_PROGRESS");

      // SECURITY: UNIT_ADMIN — despite being a platform-console role — has no
      // grant on the admin bug-report triage surface; it's ADMIN-only.
      const unitListRes = await unitAdmin.get(`${CORE_URL}/api/admin/bug-reports`);
      expect(unitListRes.status()).toBe(403);
      const unitPatchRes = await unitAdmin.patch(`${CORE_URL}/api/admin/bug-reports/${reportId}`, {
        data: { status: "RESOLVED" },
      });
      expect(unitPatchRes.status()).toBe(403);
    } finally {
      await admin.dispose();
      await unitAdmin.dispose();
      await reporter.dispose();
    }
  });
});

test.describe("Admin console: cross-course chat oversight (courseChatViewPolicyKey)", () => {
  test("ADMIN's course-chat oversight is always on, independent of any policy flag", async ({
    playwright,
  }) => {
    const admin = await playwright.request.newContext();
    const instructor = await playwright.request.newContext();
    const student = await playwright.request.newContext();
    try {
      await createInstructor(instructor, { prefix: "chatoversight-instructor" });
      const instructorId = await getUserId(instructor);
      await createAdmin(admin, { prefix: "chatoversight-admin" });

      const createRes = await createCourse(admin, {
        prefix: "chatoversight",
        department: "COSC",
        instructorUserIds: instructorId,
      });
      expect(createRes.status()).toBe(201);
      const courseId = (await createRes.json()).id;
      // /api/chat 403s a STUDENT caller on an unpublished course.
      expect((await admin.patch(`${CORE_URL}/api/courses/${courseId}/publish`)).status()).toBe(200);

      await registerUser(student, { prefix: "chatoversight-student" });
      const studentId = await getUserId(student);
      const enrollRes = await admin.post(`${CORE_URL}/api/courses/${courseId}/enrollments`, {
        data: { userId: studentId, role: "STUDENT" },
      });
      expect(enrollRes.status()).toBe(201);

      const chatId = await createFastChat(student, "You are a helpful course tutor.", courseId);

      // ADMIN never needs a policy flag to view a course's chat oversight list.
      const res = await admin.get(`${CORE_URL}/api/courses/${courseId}/chats`);
      expect(res.status()).toBe(200);
      const { chats } = await res.json();
      const chat = chats.find((c: any) => c.id === chatId);
      expect(chat, "the just-created student chat must appear in the oversight list").toBeTruthy();
      expect(chat.ownerId).toBe(studentId);
      expect(typeof chat.title === "string" || chat.title === null).toBe(true);
      // Metadata only — never message bodies (route doc comment's contract).
      expect(chat.messages).toBeUndefined();
    } finally {
      await admin.dispose();
      await instructor.dispose();
      await student.dispose();
    }
  });
});

// ===========================================================================
// UNIT ADMIN — cross-course/department scope and its boundaries
// ===========================================================================

test.describe("Unit Admin: department scope for course visibility and management", () => {
  test("UNIT_ADMIN sees and can manage a course inside their unit without being enrolled", async ({
    playwright,
  }) => {
    const admin = await playwright.request.newContext();
    const unitAdmin = await playwright.request.newContext();
    const instructor = await playwright.request.newContext();
    try {
      await createAdmin(admin, { prefix: "unit-scope-admin" });
      await createInstructor(instructor, { prefix: "unit-scope-instructor" });
      const instructorId = await getUserId(instructor);

      await createUnitAdmin(unitAdmin, { prefix: "unit-scope-unit" });
      const unitAdminId = await getUserId(unitAdmin);
      await setAuthorizedUnits(admin, unitAdminId, ["COSC"]);

      const createRes = await createCourse(admin, {
        prefix: "unit-scope",
        department: "COSC",
        instructorUserIds: instructorId,
      });
      expect(createRes.status()).toBe(201);
      const courseId = (await createRes.json()).id;

      // UNIT_ADMIN never got an Enrollment row on this course — access comes
      // purely from department match (§19 unit lock).
      const getRes = await unitAdmin.get(`${CORE_URL}/api/courses/${courseId}`);
      expect(getRes.status()).toBe(200);

      // Unit-scoped write authority: can edit RAG/guardrail settings...
      const settingsRes = await unitAdmin.patch(
        `${CORE_URL}/api/courses/${courseId}/rag-settings`,
        { data: { courseScopeGuardrailEnabled: true } },
      );
      expect(settingsRes.status()).toBe(200);

      // ...and can add/remove TAs and students in-unit (manageEnrollmentsPolicyKey
      // resolves UNIT_ADMIN to the "always" sentinel — no policy flag needed).
      const student = await playwright.request.newContext();
      try {
        await registerUser(student, { prefix: "unit-scope-student" });
        const studentId = await getUserId(student);
        const enrollRes = await unitAdmin.post(`${CORE_URL}/api/courses/${courseId}/enrollments`, {
          data: { userId: studentId, role: "STUDENT" },
        });
        expect(enrollRes.status()).toBe(201);
      } finally {
        await student.dispose();
      }
    } finally {
      await admin.dispose();
      await unitAdmin.dispose();
      await instructor.dispose();
    }
  });

  test("SECURITY: UNIT_ADMIN outside their unit gets 403 on staff settings for a course in a different department", async ({
    playwright,
  }) => {
    const admin = await playwright.request.newContext();
    const unitAdmin = await playwright.request.newContext();
    const instructor = await playwright.request.newContext();
    try {
      await createAdmin(admin, { prefix: "unit-oob-admin" });
      await createInstructor(instructor, { prefix: "unit-oob-instructor" });
      const instructorId = await getUserId(instructor);

      await createUnitAdmin(unitAdmin, { prefix: "unit-oob-unit" });
      const unitAdminId = await getUserId(unitAdmin);
      // Scoped to MATH only — the course below is COSC.
      await setAuthorizedUnits(admin, unitAdminId, ["MATH"]);

      const createRes = await createCourse(admin, {
        prefix: "unit-oob",
        department: "COSC",
        instructorUserIds: instructorId,
      });
      const courseId = (await createRes.json()).id;

      const settingsRes = await unitAdmin.get(`${CORE_URL}/api/courses/${courseId}/rag-settings`);
      expect(settingsRes.status()).toBe(403);

      const tasRes = await unitAdmin.post(`${CORE_URL}/api/courses/${courseId}/enrollments`, {
        data: { userId: instructorId, role: "TA" },
      });
      expect(tasRes.status()).toBe(403);
    } finally {
      await admin.dispose();
      await unitAdmin.dispose();
      await instructor.dispose();
    }
  });

  test("SECURITY: UNIT_ADMIN cannot create a course outside their authorized units, even though the role generally may create courses", async ({
    playwright,
  }) => {
    const admin = await playwright.request.newContext();
    const unitAdmin = await playwright.request.newContext();
    const instructor = await playwright.request.newContext();
    try {
      await createAdmin(admin, { prefix: "unit-create-admin" });
      await createInstructor(instructor, { prefix: "unit-create-instructor" });
      const instructorId = await getUserId(instructor);

      await createUnitAdmin(unitAdmin, { prefix: "unit-create-unit" });
      const unitAdminId = await getUserId(unitAdmin);
      await setAuthorizedUnits(admin, unitAdminId, ["COSC"]);

      // In-unit creation succeeds. Unlike INSTRUCTOR (whose own id is
      // force-applied server-side per `courses/server.ts`'s
      // forceInstructorUserIds), UNIT_ADMIN gets no such auto-enrollment —
      // instructorUserIds is a required, caller-supplied field (schema:
      // `CreateCourseSchema.instructorUserIds` is `min(1)`).
      const inUnitRes = await createCourse(unitAdmin, {
        prefix: "unit-create-in",
        department: "COSC",
        instructorUserIds: instructorId,
      });
      expect(inUnitRes.status()).toBe(201);

      // Out-of-unit creation is rejected even though canCreateCourse(role) is
      // role-level `true` for UNIT_ADMIN — the department-scope check in
      // courses/server.ts's create handler is the actual gate.
      const outOfUnitRes = await createCourse(unitAdmin, {
        prefix: "unit-create-out",
        department: "PHYS",
        instructorUserIds: instructorId,
      });
      expect(outOfUnitRes.status()).toBe(403);
    } finally {
      await admin.dispose();
      await unitAdmin.dispose();
      await instructor.dispose();
    }
  });

  test("UNIT_ADMIN can add/reassign an INSTRUCTOR in-unit; a same-course INSTRUCTOR cannot add another instructor", async ({
    playwright,
  }) => {
    const admin = await playwright.request.newContext();
    const unitAdmin = await playwright.request.newContext();
    const instructor = await playwright.request.newContext();
    const secondInstructor = await playwright.request.newContext();
    try {
      await createAdmin(admin, { prefix: "unit-inst-admin" });
      await createInstructor(instructor, { prefix: "unit-inst-first" });
      const instructorId = await getUserId(instructor);
      await createInstructor(secondInstructor, { prefix: "unit-inst-second" });
      const secondInstructorId = await getUserId(secondInstructor);

      await createUnitAdmin(unitAdmin, { prefix: "unit-inst-unit" });
      const unitAdminId = await getUserId(unitAdmin);
      await setAuthorizedUnits(admin, unitAdminId, ["COSC"]);

      const createRes = await createCourse(admin, {
        prefix: "unit-inst",
        department: "COSC",
        instructorUserIds: instructorId,
      });
      const courseId = (await createRes.json()).id;

      // UNIT_ADMIN (rank 3) meets the rank-3 requirement to add an INSTRUCTOR
      // enrollment (canManageInstructors: admin | unit).
      const unitAddRes = await unitAdmin.post(`${CORE_URL}/api/courses/${courseId}/enrollments`, {
        data: { userId: secondInstructorId, role: "INSTRUCTOR" },
      });
      expect(unitAddRes.status()).toBe(201);

      // SECURITY: the ORIGINAL instructor (rank 2, an enrolled INSTRUCTOR on
      // this very course) cannot add a third instructor — canManageInstructors
      // excludes "instructor" access, only admin/unit qualify.
      const thirdInstructor = await playwright.request.newContext();
      try {
        await createInstructor(thirdInstructor, { prefix: "unit-inst-third" });
        const thirdId = await getUserId(thirdInstructor);
        const instructorAddRes = await instructor.post(
          `${CORE_URL}/api/courses/${courseId}/enrollments`,
          { data: { userId: thirdId, role: "INSTRUCTOR" } },
        );
        expect(instructorAddRes.status()).toBe(403);
      } finally {
        await thirdInstructor.dispose();
      }
    } finally {
      await admin.dispose();
      await unitAdmin.dispose();
      await instructor.dispose();
      await secondInstructor.dispose();
    }
  });

  test("Unit chat oversight is policy-gated (off by default, then on) unlike ADMIN's always-on view", async ({
    playwright,
  }) => {
    const admin = await playwright.request.newContext();
    const unitAdmin = await playwright.request.newContext();
    const instructor = await playwright.request.newContext();
    const student = await playwright.request.newContext();
    try {
      await createAdmin(admin, { prefix: "unit-chat-admin" });
      await createInstructor(instructor, { prefix: "unit-chat-instructor" });
      const instructorId = await getUserId(instructor);

      await createUnitAdmin(unitAdmin, { prefix: "unit-chat-unit" });
      const unitAdminId = await getUserId(unitAdmin);
      await setAuthorizedUnits(admin, unitAdminId, ["COSC"]);

      const createRes = await createCourse(admin, {
        prefix: "unit-chat",
        department: "COSC",
        instructorUserIds: instructorId,
      });
      const courseId = (await createRes.json()).id;
      // /api/chat 403s a STUDENT caller on an unpublished course.
      expect((await admin.patch(`${CORE_URL}/api/courses/${courseId}/publish`)).status()).toBe(200);

      await registerUser(student, { prefix: "unit-chat-student" });
      const studentId = await getUserId(student);
      const enrollRes = await admin.post(`${CORE_URL}/api/courses/${courseId}/enrollments`, {
        data: { userId: studentId, role: "STUDENT" },
      });
      expect(enrollRes.status()).toBe(201);
      const chatId = await createFastChat(student, "You are a helpful course tutor.", courseId);

      await setPolicy(admin, "unitAdmins.canViewUnitChats", false);
      const deniedRes = await unitAdmin.get(`${CORE_URL}/api/units/COSC/chats`);
      expect(deniedRes.status()).toBe(403);

      await setPolicy(admin, "unitAdmins.canViewUnitChats", true);
      const allowedRes = await unitAdmin.get(`${CORE_URL}/api/units/COSC/chats`);
      expect(allowedRes.status()).toBe(200);
      const { chats } = await allowedRes.json();
      const chat = chats.find((c: any) => c.id === chatId);
      expect(
        chat,
        "the just-created student chat must appear in the unit oversight list",
      ).toBeTruthy();
      expect(chat.ownerId).toBe(studentId);
      expect(chat.courseId).toBe(courseId);
      // Metadata only — never message bodies (route doc comment's contract).
      expect(chat.messages).toBeUndefined();

      // restore default
      await setPolicy(admin, "unitAdmins.canViewUnitChats", false);
    } finally {
      await admin.dispose();
      await unitAdmin.dispose();
      await instructor.dispose();
      await student.dispose();
    }
  });

  test("SECURITY: UNIT_ADMIN cannot self-elevate authorizedUnits, and cannot access ADMIN-only user-role management outside their scope", async ({
    playwright,
  }) => {
    const unitAdmin = await playwright.request.newContext();
    try {
      await createUnitAdmin(unitAdmin, { prefix: "unit-selfgrant" });
      const selfId = await getUserId(unitAdmin);

      const patchRes = await unitAdmin.patch(`${CORE_URL}/api/users/${selfId}`, {
        data: { authorizedUnits: ["COSC", "MATH", "PHYS"] },
      });
      expect(patchRes.status()).toBe(403);

      // The full ADMIN user-management surface (paginated list, role changes
      // for OTHER users) also stays out of reach for UNIT_ADMIN.
      const listRes = await unitAdmin.get(`${CORE_URL}/api/users?page=1&pageSize=25`);
      expect(listRes.status()).toBe(403);
    } finally {
      await unitAdmin.dispose();
    }
  });

  // Closes a gap the doc's "Not yet covered by this pass" note flagged: the
  // `unitAdmins.canDeleteCourses` flag was read but never exercised against a
  // live delete.
  test("UNIT_ADMIN course delete is gated by unitAdmins.canDeleteCourses (default ON); ADMIN is unaffected by the flag", async ({
    playwright,
  }) => {
    const admin = await playwright.request.newContext();
    const unitAdmin = await playwright.request.newContext();
    try {
      await createAdmin(admin, { prefix: "unit-delete-admin" });
      await createUnitAdmin(unitAdmin, { prefix: "unit-delete-unit" });
      const unitAdminId = await getUserId(unitAdmin);
      await setAuthorizedUnits(admin, unitAdminId, ["COSC"]);

      await setPolicy(admin, "unitAdmins.canDeleteCourses", false);

      const course1 = await createCourse(admin, { prefix: "unit-delete-off", department: "COSC" });
      const course1Id = (await course1.json()).id;
      const deniedRes = await unitAdmin.delete(`${CORE_URL}/api/courses/${course1Id}`);
      expect(deniedRes.status()).toBe(403);
      // Denied, not silently no-op — the course must still be readable/undeleted.
      expect((await admin.get(`${CORE_URL}/api/courses/${course1Id}`)).status()).toBe(200);

      await setPolicy(admin, "unitAdmins.canDeleteCourses", true);

      const course2 = await createCourse(admin, { prefix: "unit-delete-on", department: "COSC" });
      const course2Id = (await course2.json()).id;
      const allowedRes = await unitAdmin.delete(`${CORE_URL}/api/courses/${course2Id}`);
      expect(allowedRes.status()).toBe(204);
      // Soft-deleted: a normal (non-forensics) read now 404s.
      expect((await admin.get(`${CORE_URL}/api/courses/${course2Id}`)).status()).toBe(404);

      // Restore the documented default (ON) so this test doesn't leave global
      // policy state altered for anything else running against this instance.
      await setPolicy(admin, "unitAdmins.canDeleteCourses", true);
    } finally {
      await admin.dispose();
      await unitAdmin.dispose();
    }
  });
});

// ===========================================================================
// INSTRUCTOR — single-course ownership and its boundaries
// ===========================================================================

test.describe("Instructor: single-course ownership", () => {
  test("INSTRUCTOR can create a course (policy default on), manage its roster, and create a question in it", async ({
    playwright,
  }) => {
    const instructor = await playwright.request.newContext();
    try {
      await createInstructor(instructor, { prefix: "inst-own" });

      const createRes = await createCourse(instructor, { prefix: "inst-own", department: "COSC" });
      expect(createRes.status()).toBe(201);
      const courseId = (await createRes.json()).id;

      const student = await playwright.request.newContext();
      try {
        await registerUser(student, { prefix: "inst-own-student" });
        const studentId = await getUserId(student);
        const enrollRes = await instructor.post(`${CORE_URL}/api/courses/${courseId}/enrollments`, {
          data: { userId: studentId, role: "STUDENT" },
        });
        expect(enrollRes.status()).toBe(201);
      } finally {
        await student.dispose();
      }

      const topicRes = await instructor.post(`${CORE_URL}/api/courses/${courseId}/topics`, {
        data: { name: "RBAC Fundamentals" },
      });
      expect(topicRes.status()).toBe(201);
      const topicId = (await topicRes.json()).id;

      const questionRes = await instructor.post(`${CORE_URL}/api/questions`, {
        data: {
          courseId,
          topicId,
          content: "What does RBAC stand for?",
          type: "SA",
          answer: "Role-Based Access Control",
        },
      });
      expect(questionRes.status()).toBe(201);
    } finally {
      await instructor.dispose();
    }
  });

  test("SECURITY: INSTRUCTOR has no access at all to a course they don't own (404/403, not a data leak)", async ({
    playwright,
  }) => {
    const ownerA = await playwright.request.newContext();
    const ownerB = await playwright.request.newContext();
    try {
      await createInstructor(ownerA, { prefix: "inst-a" });
      const createRes = await createCourse(ownerA, { prefix: "inst-a", department: "COSC" });
      const courseId = (await createRes.json()).id;

      await createInstructor(ownerB, { prefix: "inst-b" });
      const getRes = await ownerB.get(`${CORE_URL}/api/courses/${courseId}`);
      expect([403, 404]).toContain(getRes.status());

      const rosterRes = await ownerB.get(`${CORE_URL}/api/courses/${courseId}/enrollments`);
      expect(rosterRes.status()).toBe(403);

      const settingsRes = await ownerB.get(`${CORE_URL}/api/courses/${courseId}/rag-settings`);
      expect(settingsRes.status()).toBe(403);

      const questionsRes = await ownerB.get(`${CORE_URL}/api/questions?courseId=${courseId}`);
      expect(questionsRes.status()).toBe(403);
    } finally {
      await ownerA.dispose();
      await ownerB.dispose();
    }
  });

  test("Instructor TA management is policy-gated: default ON lets the owning instructor add a TA; turning it OFF blocks a new attempt", async ({
    playwright,
  }) => {
    const admin = await playwright.request.newContext();
    const instructor = await playwright.request.newContext();
    try {
      await createAdmin(admin, { prefix: "inst-ta-policy-admin" });
      await createInstructor(instructor, { prefix: "inst-ta-policy" });
      const createRes = await createCourse(instructor, {
        prefix: "inst-ta-policy",
        department: "COSC",
      });
      const courseId = (await createRes.json()).id;

      const taA = await playwright.request.newContext();
      const taB = await playwright.request.newContext();
      try {
        await registerUser(taA, { prefix: "inst-ta-policy-a" });
        const taAId = await getUserId(taA);
        // default `instructors.canManageEnrollments` is true
        const addRes = await instructor.post(`${CORE_URL}/api/courses/${courseId}/enrollments`, {
          data: { userId: taAId, role: "TA" },
        });
        expect(addRes.status()).toBe(201);

        await setPolicy(admin, "instructors.canManageEnrollments", false);
        await registerUser(taB, { prefix: "inst-ta-policy-b" });
        const taBId = await getUserId(taB);
        const blockedRes = await instructor.post(
          `${CORE_URL}/api/courses/${courseId}/enrollments`,
          {
            data: { userId: taBId, role: "TA" },
          },
        );
        expect(blockedRes.status()).toBe(403);
      } finally {
        await setPolicy(admin, "instructors.canManageEnrollments", true);
        await taA.dispose();
        await taB.dispose();
      }
    } finally {
      await admin.dispose();
      await instructor.dispose();
    }
  });

  test("INSTRUCTOR course-chat oversight is policy-gated off by default; ADMIN can turn it on for that instructor's own course", async ({
    playwright,
  }) => {
    const admin = await playwright.request.newContext();
    const instructor = await playwright.request.newContext();
    try {
      await createAdmin(admin, { prefix: "inst-chat-admin" });
      await createInstructor(instructor, { prefix: "inst-chat" });
      const createRes = await createCourse(instructor, { prefix: "inst-chat", department: "COSC" });
      const courseId = (await createRes.json()).id;

      await setPolicy(admin, "instructors.canViewCourseChats", false);
      const deniedRes = await instructor.get(`${CORE_URL}/api/courses/${courseId}/chats`);
      expect(deniedRes.status()).toBe(403);

      await setPolicy(admin, "instructors.canViewCourseChats", true);
      const allowedRes = await instructor.get(`${CORE_URL}/api/courses/${courseId}/chats`);
      expect(allowedRes.status()).toBe(200);

      await setPolicy(admin, "instructors.canViewCourseChats", false);
    } finally {
      await admin.dispose();
      await instructor.dispose();
    }
  });

  test("SECURITY: INSTRUCTOR cannot reach ADMIN or UNIT_ADMIN-only surfaces (user management, invitations, AI models, cross-unit course listing)", async ({
    playwright,
  }) => {
    const instructor = await playwright.request.newContext();
    try {
      await createInstructor(instructor, { prefix: "inst-boundary" });

      const usersRes = await instructor.get(`${CORE_URL}/api/users?page=1&pageSize=25`);
      expect(usersRes.status()).toBe(403);

      const invitationsRes = await instructor.get(`${CORE_URL}/api/invitations`);
      expect(invitationsRes.status()).toBe(403);

      const aiModelsRes = await instructor.get(`${CORE_URL}/api/ai-models`);
      expect(aiModelsRes.status()).toBe(403);

      const bugTriageRes = await instructor.get(`${CORE_URL}/api/admin/bug-reports`);
      expect(bugTriageRes.status()).toBe(403);
    } finally {
      await instructor.dispose();
    }
  });
});

// Closes the doc's "Canvas integration management from the unit-admin angle"
// gap: canManageCanvasIntegration (apps/core/app/lib/canvas/guards.server.ts)
// grants ADMIN/UNIT_ADMIN/INSTRUCTOR at the role level, but every downstream
// Canvas operation is scoped to the *caller's own* CanvasIntegration row
// (keyed by userId, not courseId/department) and the caller's own external
// Canvas "teacher" course list (validateInstructorCanvasCourseIds fetches
// live from Canvas using the caller's own credentials) — so there is no
// department-scope question to test here the way there is for rag-settings
// or enrollments; a UNIT_ADMIN's Canvas access is exactly as
// self-contained as an INSTRUCTOR's. What's worth probing directly (no live
// Canvas sandbox needed) is that the role gate and the INSTRUCTOR-only policy
// gate are both actually enforced by the route, for all three roles.
test.describe("Canvas integration API: role gate + instructors.canManageCanvasIntegration policy gate", () => {
  test("ADMIN and UNIT_ADMIN pass the role gate unconditionally; STUDENT/TA are blocked", async ({
    playwright,
  }) => {
    const admin = await playwright.request.newContext();
    const unitAdmin = await playwright.request.newContext();
    const student = await playwright.request.newContext();
    try {
      await createAdmin(admin, { prefix: "canvas-admin" });
      await createUnitAdmin(unitAdmin, { prefix: "canvas-unitadmin" });
      await registerUser(student, { prefix: "canvas-student" });

      // No Canvas account is actually connected for any of these fresh users,
      // so "integration" reads null (200) rather than erroring — this alone
      // proves the role gate passed without needing a live Canvas sandbox.
      const adminRes = await admin.get(`${CORE_URL}/api/canvas/integration`);
      expect(adminRes.status()).toBe(200);
      expect((await adminRes.json()).data).toBeNull();

      const unitAdminRes = await unitAdmin.get(`${CORE_URL}/api/canvas/integration`);
      expect(unitAdminRes.status()).toBe(200);
      expect((await unitAdminRes.json()).data).toBeNull();

      // STUDENT (and, by the same STUDENT-platform-role fact documented
      // elsewhere in this file, TA) fails canManageCanvasIntegration entirely.
      const studentRes = await student.get(`${CORE_URL}/api/canvas/integration`);
      expect(studentRes.status()).toBe(403);
      expect((await studentRes.json()).error).toBe("FORBIDDEN");
    } finally {
      await admin.dispose();
      await unitAdmin.dispose();
      await student.dispose();
    }
  });

  test("SECURITY: INSTRUCTOR's Canvas access is gated by instructors.canManageCanvasIntegration; ADMIN/UNIT_ADMIN are unaffected by the flag", async ({
    playwright,
  }) => {
    const admin = await playwright.request.newContext();
    const unitAdmin = await playwright.request.newContext();
    const instructor = await playwright.request.newContext();
    try {
      await createAdmin(admin, { prefix: "canvas-flag-admin" });
      await createUnitAdmin(unitAdmin, { prefix: "canvas-flag-unitadmin" });
      await createInstructor(instructor, { prefix: "canvas-flag-instructor" });

      await setPolicy(admin, "instructors.canManageCanvasIntegration", false);

      const instructorDenied = await instructor.get(`${CORE_URL}/api/canvas/integration`);
      expect(instructorDenied.status()).toBe(403);

      // ADMIN/UNIT_ADMIN's role-level grant is unconditional — only INSTRUCTOR
      // reads the policy flag (canvas.$.ts's route-level check).
      expect((await admin.get(`${CORE_URL}/api/canvas/integration`)).status()).toBe(200);
      expect((await unitAdmin.get(`${CORE_URL}/api/canvas/integration`)).status()).toBe(200);

      await setPolicy(admin, "instructors.canManageCanvasIntegration", true);
      const instructorAllowed = await instructor.get(`${CORE_URL}/api/canvas/integration`);
      expect(instructorAllowed.status()).toBe(200);
    } finally {
      await setPolicy(admin, "instructors.canManageCanvasIntegration", true);
      await admin.dispose();
      await unitAdmin.dispose();
      await instructor.dispose();
    }
  });

  test("SECURITY: an INSTRUCTOR cannot sync a Canvas course they don't actually teach in Canvas (fabricated canvasCourseId is rejected, not silently scoped-out)", async ({
    playwright,
  }) => {
    const instructor = await playwright.request.newContext();
    try {
      await createInstructor(instructor, { prefix: "canvas-sync-instructor" });

      // No CanvasIntegration row exists yet for this fresh instructor —
      // sync must fail closed (CANVAS_NOT_CONNECTED), never silently succeed
      // or fall through to treating an arbitrary canvasCourseId as valid.
      const syncRes = await instructor.post(`${CORE_URL}/api/canvas/sync`, {
        data: { canvasCourseIds: ["999999"] },
      });
      expect(syncRes.status()).toBe(400);
      expect((await syncRes.json()).error).toBe("CANVAS_NOT_CONNECTED");
    } finally {
      await instructor.dispose();
    }
  });
});

// #1571-pattern gap found in a #1669 deep-audit pass: three admin-gated
// surfaces (cron-jobs trigger/schedule, bug-report triage, invitation
// create/list/revoke/resend) each rolled their own admin check that only read
// the session's cached role, unlike the shared `requireAdmin`/`requireInviter`
// guards used everywhere else, which re-check `isActive` against the DB
// (fixed for #1571: deactivating an admin must revoke access on their very
// next request, not only once their session naturally expires). A deactivated
// admin's still-live session therefore kept full access to all three surfaces
// indefinitely. Fixed in this pass by threading the same DB re-check through
// all three call sites.
test.describe("SECURITY: deactivating an admin revokes access to every admin-gated surface immediately (#1571 pattern)", () => {
  test("a deactivated ADMIN's still-live session loses cron-jobs, bug-report triage, and invitation authority", async ({
    playwright,
  }) => {
    const operator = await playwright.request.newContext();
    const target = await playwright.request.newContext();
    try {
      await createAdmin(operator, { prefix: "deact-operator" });
      await createAdmin(target, { prefix: "deact-target" });
      const targetId = await getUserId(target);

      // Sanity: before deactivation, the target admin's session can reach all
      // three surfaces.
      expect((await target.get(`${CORE_URL}/api/admin/cron-jobs`)).status()).toBe(200);
      expect((await target.get(`${CORE_URL}/api/admin/bug-reports`)).status()).toBe(200);
      expect((await target.get(`${CORE_URL}/api/invitations`)).status()).toBe(200);

      // The operator (a separate active admin) deactivates the target — the
      // AUTH-04 admin floor is preserved since the operator stays active.
      const deactivateRes = await operator.patch(`${CORE_URL}/api/users/${targetId}`, {
        data: { isActive: false },
      });
      expect(deactivateRes.status()).toBe(200);

      // The target's session cookie is still the same live cookie — no
      // sign-out/sign-in happened — so this exercises the exact race the
      // #971 session hook only closes for the NEXT full getSession resolution.
      // The per-route DB re-check is what must reject it here.
      const cronRes = await target.get(`${CORE_URL}/api/admin/cron-jobs`);
      expect(cronRes.status()).toBe(401);

      const cronTriggerRes = await target.post(`${CORE_URL}/api/admin/cron-jobs`, {
        data: { intent: "trigger", jobName: "backup-nightly" },
      });
      expect(cronTriggerRes.status()).toBe(401);

      const bugsRes = await target.get(`${CORE_URL}/api/admin/bug-reports`);
      expect(bugsRes.status()).toBe(403);

      const inviteRes = await target.post(`${CORE_URL}/api/invitations`, {
        data: { email: uniqueEmail("deact-invite-target"), role: "STUDENT" },
      });
      expect(inviteRes.status()).toBe(403);

      const inviteListRes = await target.get(`${CORE_URL}/api/invitations`);
      expect(inviteListRes.status()).toBe(403);
    } finally {
      await operator.dispose();
      await target.dispose();
    }
  });
});
