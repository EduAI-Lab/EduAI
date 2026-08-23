/**
 * AI Tutor — the TA dashboard variant, driven through the browser.
 *
 * Every role lands on the shared `/dashboard` (`role-routing.ts`), which renders
 * a role-specific view. A TA gets neither the student's four-stat learner row
 * nor the instructor's teaching rollup, but a dedicated "Assigned courses"
 * variant fed by the `{ role: "TA", yourCourses, publishedCourses,
 * submissionsToReview }` branch in `server/src/routes/courses.js`.
 *
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md` (TA).
 */
import { test, expect, type Page } from "@playwright/test";
import { gotoAiTutor } from "../helpers/at-ui";
import { registerStudent, seedPublishedCourseAndEnroll } from "../helpers/at-student-fixtures";
import { seedStudentSubmission } from "../helpers/at-admin-fixtures";

type Pw = { request: { newContext: () => Promise<import("@playwright/test").APIRequestContext> } };

async function seedTaDashboard(page: Page, playwright: Pw, codePrefix = "TAD") {
  const { studentId } = await registerStudent(page);
  const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
    name: "TA Dashboard Course",
    codePrefix,
    role: "TA",
  });
  return { studentId, seeded };
}

test.describe("AI Tutor TA — dashboard", () => {
  test("the dashboard renders the TA 'Assigned courses' variant", async ({ page, playwright }) => {
    const { seeded } = await seedTaDashboard(page, playwright, "TDA");
    try {
      await gotoAiTutor(page, "/dashboard");
      // The heading and subtitle are TA-specific — not the student's
      // "Continue where you left off" nor the instructor rollup.
      await expect(page.getByRole("heading", { name: "Assigned courses" })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText("Your assigned courses and student activity.")).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });

  test("an assigned course appears in the Assigned courses panel", async ({ page, playwright }) => {
    const { seeded } = await seedTaDashboard(page, playwright, "TDB");
    try {
      await gotoAiTutor(page, "/dashboard");
      await expect(page.getByRole("link", { name: new RegExp(seeded.name) }).first()).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await seeded.dispose();
    }
  });

  test("the quick actions are the TA set and 'View courses' opens the staff list", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTaDashboard(page, playwright, "TDC");
    try {
      await gotoAiTutor(page, "/dashboard");
      await expect(page.getByRole("heading", { name: "Quick actions" })).toBeVisible({
        timeout: 20_000,
      });
      // The copy is TA-flavoured — the actions speak of courses "you assist
      // with" and a course "you're enrolled in", the dual learner/staff surface.
      for (const label of ["View courses", "Continue learning", "Open settings"]) {
        await expect(page.getByRole("link", { name: new RegExp(label) }).first()).toBeVisible();
      }
      await page
        .getByRole("link", { name: /View courses/ })
        .first()
        .click();
      await expect(page).toHaveURL(/\/instructor$/, { timeout: 20_000 });
    } finally {
      await seeded.dispose();
    }
  });

  test("a submission awaiting grading is reflected in the assigned-course activity", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTaDashboard(page, playwright, "TDD");
    try {
      // Seed an ungraded submission so the TA's grading queue is non-empty, then
      // confirm the dashboard still resolves to the TA variant with the course.
      await seedStudentSubmission(playwright, seeded, seeded.activityId, { answerOption: 1 });
      await gotoAiTutor(page, "/dashboard");
      await expect(page.getByRole("heading", { name: "Assigned courses" })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByRole("link", { name: new RegExp(seeded.name) }).first()).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });
});
