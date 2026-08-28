/**
 * AI Tutor — a TA reaches the same STUDENT shell (`/student/*`).
 *
 * A course TA is not a platform role: it's a STUDENT-platform user carrying an
 * `EnrollmentRole.TA` enrollment (Core dropped `UserRole.TA`, so
 * `/api/e2e/promote` rejects "TA"). The only way to make one is to enrol a
 * student in a course with role TA — which `seedPublishedCourseAndEnroll`
 * supports via `role: "TA"`. AI Tutor's enrolment mirror includes TA
 * (`enrollmentSync.js` `MIRRORED_ROLES`), so a TA must see the enrolled course
 * and open its lesson exactly as a student does.
 *
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md`.
 */
import { test, expect } from "@playwright/test";
import { gotoAiTutor } from "../helpers/at-ui";
import { registerStudent, seedPublishedCourseAndEnroll } from "../helpers/at-student-fixtures";

test.describe("AI Tutor STUDENT — TA enrolment shares the student shell", () => {
  test("a TA sees the enrolled course and can open its lesson player", async ({
    page,
    playwright,
  }) => {
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "TA Access Course",
      codePrefix: "TAA",
      role: "TA",
      question: "Which case stops a recursion?",
    });
    try {
      // The TA's enrolled-course list is the same `/student` surface.
      await gotoAiTutor(page, "/student");
      const card = page.getByRole("link", { name: new RegExp(seeded.name) }).first();
      await expect(card).toBeVisible({ timeout: 20_000 });

      // And the lesson player opens for them — the enrolment gate lets a TA read
      // published content just like a student.
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      await expect(page.getByText("Which case stops a recursion?")).toBeVisible({
        timeout: 20_000,
      });
      // Match the chat panel header exactly — the fleet-unavailable fallback
      // message ("AI study buddy not available right now…") also contains this
      // text, so a substring match resolves to two elements in CI where no live
      // model answers.
      await expect(page.getByText("AI study buddy", { exact: true })).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });
});
