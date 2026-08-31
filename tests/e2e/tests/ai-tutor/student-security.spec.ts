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

type SubmissionRow = { activityId: number; userId: string };

/** The caller's own attempts, from the self-scoped `GET /me/submissions`. */
async function ownSubmissions(
  ctx: import("@playwright/test").APIRequestContext,
): Promise<SubmissionRow[]> {
  const res = await ctx.get(`${AT}/api/me/submissions`);
  expect(res.status()).toBe(200);
  return (await res.json()) as SubmissionRow[];
}

test.describe("AI Tutor STUDENT — answer-submission gate", () => {
  test("an enrolled student's answer lands on the caller, never a spoofed body.userId", async ({
    playwright,
  }) => {
    // The route comment is "never trust body.userId". The submission contract
    // is strict: a body carrying fields beyond the answer itself (such as a
    // spoofed `userId`) is refused with 400, so nothing can be persisted
    // against anyone. A clean answer must then land on the authenticated
    // caller, and the victim must have no row for the activity.
    const studentCtx = await playwright.request.newContext();
    const victimCtx = await playwright.request.newContext();
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

        // A real victim to impersonate — registered but never enrolled here.
        await registerUser(victimCtx, { prefix: "at-sec-victim" });
        const { id: victimId } = await (await victimCtx.get(`${CORE_URL}/api/me`)).json();

        await registerUser(studentCtx, { prefix: "at-sec-spoof" });
        const { id: studentId } = await (await studentCtx.get(`${CORE_URL}/api/me`)).json();
        await seeded.admin.post(`${CORE_URL}/api/courses/${seeded.coreCourseId}/enrollments`, {
          data: { userId: studentId, role: "STUDENT" },
        });
        await seeded.admin.post(`${AT}/api/admin/courses/${seeded.atCourseId}/enrollments`, {
          data: { userId: studentId, role: "STUDENT" },
        });

        // The strict submission contract rejects any body carrying fields
        // beyond the answer itself, so a spoofed `userId` is neither persisted
        // nor silently ignored — the request is refused outright.
        const spoofRes = await studentCtx.post(`${AT}/api/questions/${seeded.activityId}/answer`, {
          data: { answerOption: 0, userId: victimId },
        });
        expect(spoofRes.status()).toBe(400);

        // The rejected spoof attempt left no submission rows behind...
        const rowsAfterSpoof = await ownSubmissions(studentCtx);
        expect(
          rowsAfterSpoof.some((r) => r.activityId === seeded.activityId),
          "the rejected spoof attempt recorded nothing",
        ).toBe(false);

        // ...and a clean submission lands on the authenticated caller.
        const res = await studentCtx.post(`${AT}/api/questions/${seeded.activityId}/answer`, {
          data: { answerOption: 0 },
        });
        expect(res.status()).toBe(200);
        const callerRows = await ownSubmissions(studentCtx);
        const callerAttempt = callerRows.find((r) => r.activityId === seeded.activityId);
        expect(callerAttempt, "the caller's own attempt is recorded").toBeTruthy();
        expect(callerAttempt?.userId).toBe(studentId);

        // The spoofed victim still has no attempt for this activity.
        const victimRows = await ownSubmissions(victimCtx);
        expect(
          victimRows.some((r) => r.activityId === seeded.activityId),
          "the spoofed victim has no attempt for this activity",
        ).toBe(false);
      } finally {
        await seeded.dispose();
      }
    } finally {
      await studentCtx.dispose();
      await victimCtx.dispose();
    }
  });

  test("a course TA (platform STUDENT enrolled as TA) cannot submit an answer (403, no submission)", async ({
    playwright,
  }) => {
    // A course TA is a platform STUDENT carrying an `EnrollmentRole.TA`. They
    // clear the platform-role gate (role === "STUDENT"), but the enrolment gate
    // derives the allowed enrolment role from that platform role — STUDENT —
    // so a TA *enrolment* is not in `allowedRoles` and the answer is refused.
    // This pins the boundary the integration suite asserts (activities.test.js)
    // at the e2e layer: 403 and no `Submission` row.
    const taCtx = await playwright.request.newContext();
    try {
      const seeded = await seedCourseWithActivity(playwright, {
        name: "TA Answer Gate",
        codePrefix: "TAG",
        publish: true,
      });
      try {
        await seeded.admin.patch(`${AT}/api/modules/${seeded.moduleId}/publish`);
        await seeded.admin.patch(`${AT}/api/lessons/${seeded.lessonId}/publish`);

        await registerUser(taCtx, { prefix: "at-sec-ta-answer" });
        const { id: taId } = await (await taCtx.get(`${CORE_URL}/api/me`)).json();
        await seeded.admin.post(`${CORE_URL}/api/courses/${seeded.coreCourseId}/enrollments`, {
          data: { userId: taId, role: "TA" },
        });
        await seeded.admin.post(`${AT}/api/admin/courses/${seeded.atCourseId}/enrollments`, {
          data: { userId: taId, role: "TA" },
        });

        const res = await taCtx.post(`${AT}/api/questions/${seeded.activityId}/answer`, {
          data: { answerOption: 0 },
        });
        expect(res.status()).toBe(403);

        // The refusal is real: no attempt was recorded for the TA.
        const rows = await ownSubmissions(taCtx);
        expect(rows.some((r) => r.activityId === seeded.activityId)).toBe(false);
      } finally {
        await seeded.dispose();
      }
    } finally {
      await taCtx.dispose();
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
