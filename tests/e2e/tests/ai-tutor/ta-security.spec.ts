/**
 * AI Tutor — TA API-level authorization boundaries.
 *
 * These back the Security column with checks no screen walks. A TA is course
 * teaching staff for *their* course and a plain learner everywhere else, and is
 * never a content manager or an admin. The matrix:
 *   - own course: submissions / feedback / analytics reads → 200; activity-level
 *     submissions + feedback + the grade override → 200 (the BUG-TA-1 fix);
 *   - authoring (create module, publish, create activity) → 403;
 *   - enrolment management (Core and AI Tutor) → 403;
 *   - admin endpoints → 403;
 *   - a course the TA has no enrolment on → 403 on every course-scoped read.
 *
 * Companion API specs cover the shared gates: `rbac.spec.ts` (mutation/admin/
 * unauth), `content-lifecycle.spec.ts` (publish visibility).
 *
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md` (TA).
 */
import { test, expect, type Page } from "@playwright/test";
import { AI_TUTOR_API_URL, CORE_URL } from "../../playwright.config";
import { registerStudent, seedPublishedCourseAndEnroll } from "../helpers/at-student-fixtures";
import {
  seedAtCourse,
  seedModule,
  seedLesson,
  seedStudentSubmission,
} from "../helpers/at-admin-fixtures";

const AT = AI_TUTOR_API_URL;
type Pw = { request: { newContext: () => Promise<import("@playwright/test").APIRequestContext> } };

async function seedTa(page: Page, playwright: Pw, codePrefix: string) {
  const { studentId } = await registerStudent(page);
  const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
    name: "TA Security Course",
    codePrefix,
    role: "TA",
  });
  return { studentId, seeded };
}

test.describe("AI Tutor TA — course-staff reads on their own course", () => {
  test("submissions, feedback, and analytics are all 200", async ({ page, playwright }) => {
    const { seeded } = await seedTa(page, playwright, "SC1");
    try {
      for (const path of ["submissions", "feedback", "analytics"]) {
        const res = await page.request.get(`${AT}/api/courses/${seeded.atCourseId}/${path}`);
        expect(res.status(), `GET course ${path}`).toBe(200);
      }
    } finally {
      await seeded.dispose();
    }
  });

  test("activity submissions, feedback, and the grade override are 200 (BUG-TA-1 fix)", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTa(page, playwright, "SC2");
    try {
      await seedStudentSubmission(playwright, seeded, seeded.activityId, { answerOption: 1 });
      // Find the submission via the course-level list (already staff-authorized).
      const list = await page.request.get(`${AT}/api/courses/${seeded.atCourseId}/submissions`);
      expect(list.status()).toBe(200);
      const rows = await list.json();
      const first = Array.isArray(rows) ? rows[0] : rows.data?.[0];

      // Activity-level reads and the grade PATCH all authorize the TA enrolment
      // role explicitly now — each returned 403 before the fix.
      expect(
        (await page.request.get(`${AT}/api/activities/${first.activityId}/submissions`)).status(),
      ).toBe(200);
      expect(
        (await page.request.get(`${AT}/api/activities/${first.activityId}/feedback`)).status(),
      ).toBe(200);
      const patch = await page.request.patch(
        `${AT}/api/activities/${first.activityId}/submissions/${first.id}`,
        { data: { isCorrect: true, score: 100 } },
      );
      expect(patch.status()).toBe(200);
      expect((await patch.json()).isCorrect).toBe(true);
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor TA — actions a TA is refused", () => {
  test("authoring content is 403", async ({ page, playwright }) => {
    const { seeded } = await seedTa(page, playwright, "SA1");
    try {
      // canManageContent is false for a TA: no create module, publish, or author.
      expect(
        (
          await page.request.post(`${AT}/api/courses/${seeded.atCourseId}/modules`, {
            data: { title: "TA should not create this" },
          })
        ).status(),
      ).toBe(403);
      expect(
        (await page.request.patch(`${AT}/api/modules/${seeded.moduleId}/publish`)).status(),
      ).toBe(403);
      expect(
        (
          await page.request.post(`${AT}/api/lessons/${seeded.lessonId}/activities`, {
            data: {
              question: "nope",
              type: "MCQ",
              options: ["a", "b"],
              answer: { correctIndex: 0 },
              mainTopicId: seeded.topicIds[0],
            },
          })
        ).status(),
      ).toBe(403);
    } finally {
      await seeded.dispose();
    }
  });

  test("managing enrolments is 403 on both Core and AI Tutor", async ({ page, playwright }) => {
    const { studentId, seeded } = await seedTa(page, playwright, "SA2");
    try {
      expect(
        (
          await page.request.post(`${AT}/api/admin/courses/${seeded.atCourseId}/enrollments`, {
            data: { userId: studentId, role: "STUDENT" },
          })
        ).status(),
      ).toBe(403);
      expect(
        (
          await page.request.post(`${CORE_URL}/api/courses/${seeded.coreCourseId}/enrollments`, {
            data: { userId: studentId, role: "STUDENT" },
          })
        ).status(),
      ).toBe(403);
    } finally {
      await seeded.dispose();
    }
  });

  test("submitting an answer is 403 — recording attempts is a STUDENT path only", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTa(page, playwright, "SA5");
    try {
      // A TA reads the lesson player but is not a submitter: `POST
      // /questions/:id/answer` is gated to enrolled STUDENTs. (Contrast the
      // grade override, which the isTa branch does authorize — BUG-TA-1.)
      const res = await page.request.post(`${AT}/api/questions/${seeded.activityId}/answer`, {
        data: { answerOption: 0 },
      });
      expect(res.status()).toBe(403);
    } finally {
      await seeded.dispose();
    }
  });

  test("admin endpoints are 403", async ({ page, playwright }) => {
    const { seeded } = await seedTa(page, playwright, "SA3");
    try {
      expect((await page.request.get(`${AT}/api/admin/ai-traces`)).status()).toBe(403);
      expect((await page.request.get(`${AT}/api/admin/users`)).status()).toBe(403);
    } finally {
      await seeded.dispose();
    }
  });

  test("every course-scoped read on a course the TA does not assist is 403", async ({
    page,
    playwright,
  }) => {
    const { seeded: mine } = await seedTa(page, playwright, "SA4");
    const foreign = await seedAtCourse(playwright, {
      name: "Foreign Security Course",
      codePrefix: "FSC",
      topics: ["Graphs"],
      publish: true,
    });
    const mod = await seedModule(foreign.admin, foreign.atCourseId, { title: "Fm", publish: true });
    await seedLesson(foreign.admin, mod.id, { title: "Fl", publish: true });
    try {
      for (const path of ["", "/submissions", "/feedback", "/analytics"]) {
        const res = await page.request.get(`${AT}/api/courses/${foreign.atCourseId}${path}`);
        expect(res.status(), `GET foreign course${path}`).toBe(403);
      }
    } finally {
      await mine.dispose();
      await foreign.dispose();
    }
  });
});
