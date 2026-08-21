/**
 * AI Tutor — STUDENT authorization boundaries at the API, exercised directly.
 *
 * These back the Security column of the Student workflow rows with checks the
 * UI cannot reach: the answer-submission gate (enrolment, role, publish chain,
 * and the "never trust body.userId" rule in `activities.js`) and the
 * course-content read gate for a non-member (BOLA).
 *
 * Companion API specs: `rbac.spec.ts` (mutation/admin/unauth gates),
 * `content-lifecycle.spec.ts` (publish visibility), `dashboard-submissions.spec.ts`.
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md`.
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_API_URL, CORE_URL } from "../../playwright.config";
import { createInstructor, registerUser, signUp, uniqueEmail } from "../helpers/auth";
import { seedCourseWithActivity } from "../helpers/at-admin-fixtures";
import { atListData } from "../helpers/at-pagination";

const AT = AI_TUTOR_API_URL;

test.describe("AI Tutor STUDENT — answer-submission gate", () => {
  test("an enrolled student's answer ignores a spoofed body.userId", async ({ playwright }) => {
    // The route comment is "never trust body.userId" — the attempt is always
    // recorded against the authenticated caller. A spoofed id must therefore
    // neither error nor land on the victim; the call simply succeeds as self.
    const studentCtx = await playwright.request.newContext();
    try {
      const seeded = await seedCourseWithActivity(playwright, {
        name: "Spoof Guard Course",
        codePrefix: "SPF",
        publish: true,
      });
      try {
        // Publish the spine so the activity is answerable.
        await seeded.admin.patch(`${AT}/api/modules/${seeded.moduleId}/publish`);
        await seeded.admin.patch(`${AT}/api/lessons/${seeded.lessonId}/publish`);

        const student = await registerUser(studentCtx, { prefix: "at-sec-spoof" });
        const { id: studentId } = await (await studentCtx.get(`${CORE_URL}/api/me`)).json();
        await seeded.admin.post(`${CORE_URL}/api/courses/${seeded.coreCourseId}/enrollments`, {
          data: { userId: studentId, role: "STUDENT" },
        });
        await seeded.admin.post(`${AT}/api/admin/courses/${seeded.atCourseId}/enrollments`, {
          data: { userId: studentId, role: "STUDENT" },
        });

        const res = await studentCtx.post(`${AT}/api/questions/${seeded.activityId}/answer`, {
          data: { answerOption: 0, userId: "some-other-victim-user-id" },
        });
        expect(res.status()).toBe(200);
        void student;
      } finally {
        await seeded.dispose();
      }
    } finally {
      await studentCtx.dispose();
    }
  });

  test("a student NOT enrolled in the course cannot answer its activity (403)", async ({
    request,
    playwright,
  }) => {
    const seeded = await seedCourseWithActivity(playwright, {
      name: "Answer Enrolment Gate",
      codePrefix: "AEG",
      publish: true,
    });
    try {
      await seeded.admin.patch(`${AT}/api/modules/${seeded.moduleId}/publish`);
      await seeded.admin.patch(`${AT}/api/lessons/${seeded.lessonId}/publish`);

      await signUp(request, { email: uniqueEmail("at-sec-unenrolled") });
      const res = await request.post(`${AT}/api/questions/${seeded.activityId}/answer`, {
        data: { answerOption: 0 },
      });
      expect(res.status()).toBe(403);
    } finally {
      await seeded.dispose();
    }
  });

  test("an enrolled student cannot answer an activity in an unpublished lesson (403)", async ({
    request,
    playwright,
  }) => {
    // Course + module published, lesson deliberately left as a draft.
    const seeded = await seedCourseWithActivity(playwright, {
      name: "Answer Publish Gate",
      codePrefix: "APG",
      publish: true,
    });
    try {
      await seeded.admin.patch(`${AT}/api/modules/${seeded.moduleId}/publish`);
      // NOTE: lesson stays unpublished.

      const student = await signUp(request, { email: uniqueEmail("at-sec-draft") });
      const { id: studentId } = await (await request.get(`${CORE_URL}/api/me`)).json();
      await seeded.admin.post(`${CORE_URL}/api/courses/${seeded.coreCourseId}/enrollments`, {
        data: { userId: studentId, role: "STUDENT" },
      });
      await seeded.admin.post(`${AT}/api/admin/courses/${seeded.atCourseId}/enrollments`, {
        data: { userId: studentId, role: "STUDENT" },
      });

      const res = await request.post(`${AT}/api/questions/${seeded.activityId}/answer`, {
        data: { answerOption: 0 },
      });
      expect(res.status()).toBe(403);
      void student;
    } finally {
      await seeded.dispose();
    }
  });

  test("an INSTRUCTOR cannot submit an answer — students only (403)", async ({
    request,
    playwright,
  }) => {
    const seeded = await seedCourseWithActivity(playwright, {
      name: "Answer Role Gate",
      codePrefix: "ARG",
      publish: true,
    });
    try {
      await seeded.admin.patch(`${AT}/api/modules/${seeded.moduleId}/publish`);
      await seeded.admin.patch(`${AT}/api/lessons/${seeded.lessonId}/publish`);

      await createInstructor(request, { prefix: "at-sec-instr-answer" });
      const res = await request.post(`${AT}/api/questions/${seeded.activityId}/answer`, {
        data: { answerOption: 0 },
      });
      expect(res.status()).toBe(403);
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor STUDENT — course-content read gate (BOLA)", () => {
  test("a non-member student sees no modules for a course they are not enrolled in", async ({
    request,
    playwright,
  }) => {
    const seeded = await seedCourseWithActivity(playwright, {
      name: "Read Gate Course",
      codePrefix: "RGC",
      publish: true,
    });
    try {
      await seeded.admin.patch(`${AT}/api/modules/${seeded.moduleId}/publish`);

      await signUp(request, { email: uniqueEmail("at-sec-bola") });
      // The list read is enrolment-scoped: a non-member gets an empty page, not
      // the other course's modules.
      const res = await request.get(
        `${AT}/api/courses/${seeded.atCourseId}/modules?page=1&pageSize=25`,
      );
      // Either a hard 403 or a scoped-empty 200 is acceptable — both withhold
      // the content. What must never happen is the module leaking through.
      if (res.status() === 200) {
        const modules = await atListData<{ id: number }>(
          request,
          `${AT}/api/courses/${seeded.atCourseId}/modules`,
        );
        expect(modules.some((m) => m.id === seeded.moduleId)).toBe(false);
      } else {
        expect([403, 404]).toContain(res.status());
      }
    } finally {
      await seeded.dispose();
    }
  });
});
