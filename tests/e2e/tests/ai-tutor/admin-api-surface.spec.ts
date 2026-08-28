/**
 * AI Tutor — ADMIN server surfaces that no screen exposes.
 *
 * The workflow doc's scope note says an AI Tutor admin "is deliberately not a
 * user-management surface". That is true of the UI and false of the API: the
 * server still exposes a full course-enrolment CRUD and a Core user roster to
 * ADMIN, plus a prompt-template store that ADMIN is — surprisingly — locked out
 * of. None of it is reachable by clicking, so it is covered here at the request
 * level rather than through the browser.
 *
 * These are the paths a human pass cannot walk, so they need a test more than
 * the clickable ones do.
 *
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md`.
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_API_URL, CORE_URL } from "../../playwright.config";
import { createAdmin, registerUser } from "../helpers/auth";
import { seedAtCourse, seedCourseWithActivity } from "../helpers/at-admin-fixtures";

test.describe("AI Tutor ADMIN — enrolment API with no UI", () => {
  test("an admin can list, re-role, and remove a course enrolment", async ({ playwright }) => {
    // `routes/admin.js` grants ADMIN/UNIT_ADMIN/INSTRUCTOR the whole enrolment
    // lifecycle on any course. Enrolments are supposed to be owned by Core and
    // synced from Canvas, so this is a writable side door worth pinning: if the
    // endpoints are ever tightened, this test should be the thing that notices.
    const seeded = await seedAtCourse(playwright, {
      name: "Enrolment API Course",
      codePrefix: "ENRL",
    });
    const studentCtx = await playwright.request.newContext();
    try {
      await registerUser(studentCtx, { name: "E2E Enrolled Student", prefix: "at-admin-enrol" });
      const { id: studentId } = await (await studentCtx.get(`${CORE_URL}/api/me`)).json();

      // Core is the system of record, so enrol there first, then mirror.
      expect(
        (
          await seeded.admin.post(`${CORE_URL}/api/courses/${seeded.coreCourseId}/enrollments`, {
            data: { userId: studentId, role: "STUDENT" },
          })
        ).status(),
      ).toBe(201);

      const base = `${AI_TUTOR_API_URL}/api/admin/courses/${seeded.atCourseId}/enrollments`;
      expect(
        (await seeded.admin.post(base, { data: { userId: studentId, role: "STUDENT" } })).status(),
      ).toBe(201);

      const listed = await seeded.admin.get(base);
      expect(listed.status()).toBe(200);
      // The list answers `{ courseId, enrolledStudents, availableStudents, … }`
      // and resolves display names through Core rather than echoing raw ids.
      const body = await listed.json();
      const enrolled = body.enrolledStudents as Array<{ id: string; name: string; role: string }>;
      const row = enrolled.find((r) => r.id === studentId);
      expect(row).toBeTruthy();
      expect(row?.role).toBe("STUDENT");
      expect(row?.name).toBe("E2E Enrolled Student");

      // Re-roling to TA is an audit-preserving PATCH, not a delete/recreate,
      // and it writes Core first so the two stores cannot drift.
      const reroled = await seeded.admin.patch(`${base}/${studentId}/role`, {
        data: { role: "TA" },
      });
      expect(reroled.status()).toBe(200);
      expect((await reroled.json()).role).toBe("TA");

      const removed = await seeded.admin.delete(`${base}/${studentId}`);
      expect([200, 204]).toContain(removed.status());
    } finally {
      await studentCtx.dispose();
      await seeded.dispose();
    }
  });

  test("an enrolment created here is written through to Core, so it can be managed", async ({
    playwright,
  }) => {
    // Regression (BUG-9): POST used to upsert the AI Tutor `CourseEnrollment`
    // row without telling Core, while PATCH .../role refuses unless a matching
    // Core enrolment exists. An admin could therefore create a local-only
    // enrolment — course access Core's audit trail never recorded — and then be
    // unable to manage it. POST now writes through first.
    const seeded = await seedAtCourse(playwright, {
      name: "Write Through Enrolment Course",
      codePrefix: "ENRM",
    });
    const studentCtx = await playwright.request.newContext();
    try {
      await registerUser(studentCtx, { prefix: "at-admin-enrol-mirror" });
      const { id: studentId } = await (await studentCtx.get(`${CORE_URL}/api/me`)).json();

      const base = `${AI_TUTOR_API_URL}/api/admin/courses/${seeded.atCourseId}/enrollments`;
      expect(
        (await seeded.admin.post(base, { data: { userId: studentId, role: "STUDENT" } })).status(),
      ).toBe(201);

      // Core knows about it, so the role can be changed afterwards.
      const reroled = await seeded.admin.patch(`${base}/${studentId}/role`, {
        data: { role: "TA" },
      });
      expect(reroled.status()).toBe(200);
      expect((await reroled.json()).role).toBe("TA");
    } finally {
      await studentCtx.dispose();
      await seeded.dispose();
    }
  });

  test("the enrolment API is closed to a student", async ({ playwright }) => {
    const seeded = await seedAtCourse(playwright, {
      name: "Enrolment Guard Course",
      codePrefix: "ENRG",
    });
    const studentCtx = await playwright.request.newContext();
    try {
      const { id: selfId } = await (async () => {
        await registerUser(studentCtx, { prefix: "at-admin-enrol-guard" });
        return (await studentCtx.get(`${CORE_URL}/api/me`)).json();
      })();

      const base = `${AI_TUTOR_API_URL}/api/admin/courses/${seeded.atCourseId}/enrollments`;
      expect((await studentCtx.get(base)).status()).toBe(403);
      // Most importantly: a student cannot enrol themselves.
      expect((await studentCtx.post(base, { data: { userId: selfId, role: "TA" } })).status()).toBe(
        403,
      );
    } finally {
      await studentCtx.dispose();
      await seeded.dispose();
    }
  });

  test("the Core user roster is readable by an admin and refused to a student", async ({
    playwright,
  }) => {
    const admin = await playwright.request.newContext();
    const student = await playwright.request.newContext();
    try {
      await createAdmin(admin, { prefix: "at-admin-roster" });
      await registerUser(student, { prefix: "at-admin-roster-student" });

      const url = `${AI_TUTOR_API_URL}/api/admin/users?page=1&pageSize=5`;
      const asAdmin = await admin.get(url);
      expect(asAdmin.status()).toBe(200);
      const body = await asAdmin.json();
      expect(Array.isArray(body.data)).toBe(true);
      // #1041: paging is required rather than proxying a whole table.
      expect(body).toHaveProperty("total");

      expect((await student.get(url)).status()).toBe(403);
    } finally {
      await admin.dispose();
      await student.dispose();
    }
  });

  test("writing a role through AI Tutor is refused: roles are owned by Core", async ({
    playwright,
  }) => {
    // Deliberately 410 rather than 404 so a caller gets an explicit signal
    // instead of thinking the route moved.
    const admin = await playwright.request.newContext();
    const target = await playwright.request.newContext();
    try {
      await createAdmin(admin, { prefix: "at-admin-role-write" });
      await registerUser(target, { prefix: "at-admin-role-target" });
      const { id: targetId } = await (await target.get(`${CORE_URL}/api/me`)).json();

      const res = await admin.patch(`${AI_TUTOR_API_URL}/api/admin/users/${targetId}/role`, {
        data: { role: "INSTRUCTOR" },
      });
      expect(res.status()).toBe(410);
      expect((await res.json()).error).toMatch(/managed in EduAI/i);
    } finally {
      await admin.dispose();
      await target.dispose();
    }
  });
});

test.describe("AI Tutor ADMIN — prompt templates", () => {
  test("an admin reaches the prompt-template store, a student does not", async ({ playwright }) => {
    // Regression (BUG-10): `routes/prompts.js` gated both reads and writes on
    // `requireRole("INSTRUCTOR")` — a bare string, not a list — so ADMIN and
    // UNIT_ADMIN were 403'd off a surface holding system prompts, temperature
    // and topP, contradicting "admin ⊇ instructor" everywhere else in the app.
    const admin = await playwright.request.newContext();
    const instructor = await playwright.request.newContext();
    const student = await playwright.request.newContext();
    try {
      await createAdmin(admin, { prefix: "at-admin-prompts" });
      expect((await admin.get(`${AI_TUTOR_API_URL}/api/prompts`)).status()).toBe(200);
      expect(
        (
          await admin.post(`${AI_TUTOR_API_URL}/api/prompts`, {
            data: { name: `E2E admin prompt ${Date.now()}`, systemPrompt: "Be helpful." },
          })
        ).status(),
      ).toBe(201);

      // An instructor still gets in...
      const { createInstructor } = await import("../helpers/auth");
      await createInstructor(instructor, { prefix: "at-admin-prompts-instr" });
      expect((await instructor.get(`${AI_TUTOR_API_URL}/api/prompts`)).status()).toBe(200);

      // ...and widening the gate did not open it to students.
      await registerUser(student, { prefix: "at-admin-prompts-student" });
      expect((await student.get(`${AI_TUTOR_API_URL}/api/prompts`)).status()).toBe(403);
    } finally {
      await admin.dispose();
      await instructor.dispose();
      await student.dispose();
    }
  });
});

test.describe("AI Tutor ADMIN — tutoring chat is closed server-side", () => {
  test("an admin is refused every AI tutoring mode, not merely redirected", async ({
    playwright,
  }) => {
    // The workflow doc records `/student/*` as "correctly blocked", but that
    // guard is a `clientLoader` in an `ssr: false` SPA — a cosmetic redirect on
    // its own. The claim only holds because the server refuses too:
    // `POST /activities/:id/{teach,guide,custom}` each answer
    // 403 "Only students can use AI tutoring" for any non-STUDENT role.
    // Asserting it here is what makes the security column honest.
    const seeded = await seedCourseWithActivity(playwright, {
      name: "Tutor Gate Course",
      codePrefix: "TGATE",
      publish: true,
    });
    try {
      for (const mode of ["teach", "guide", "custom"]) {
        const res = await seeded.admin.post(
          `${AI_TUTOR_API_URL}/api/activities/${seeded.activityId}/${mode}`,
          { data: { message: "Explain this to me." } },
        );
        expect(res.status(), `${mode} must refuse an ADMIN`).toBe(403);
        expect((await res.json()).error).toMatch(/only students/i);
      }
    } finally {
      await seeded.dispose();
    }
  });
});
