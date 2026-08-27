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
import { seedStudentSubmission, seedShortTextActivity } from "../helpers/at-admin-fixtures";

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

  test("an ungraded submission is counted in the TA 'To review' stat", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTaDashboard(page, playwright, "TDD");
    try {
      // Seed a genuinely *ungraded* submission so the TA's grading queue is
      // non-empty. MCQ (and answer-keyed short-text) auto-grade on submit, so
      // they never enter the `isCorrect: null` queue — an open-ended SHORT_TEXT
      // activity is the realistic source. A student submits a text answer to it,
      // which stays ungraded, then we assert the dashboard's "To review" stat
      // actually reflects it (it reads the server's `submissionsToReview`
      // rollup, #1626), so a count of 0 would mean it never reached the UI.
      const openEnded = await seedShortTextActivity(
        seeded.admin,
        seeded.lessonId,
        seeded.topicIds[0],
      );
      await seedStudentSubmission(playwright, seeded, openEnded.id, {
        answerText: "The base case returns without recursing, so the stack unwinds.",
      });
      await gotoAiTutor(page, "/dashboard");
      await expect(page.getByRole("heading", { name: "Assigned courses" })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByRole("link", { name: new RegExp(seeded.name) }).first()).toBeVisible();

      // The StatCard renders the label and value as sibling <div>s; assert the
      // value beside "To review" is non-zero.
      const reviewLabel = page.getByText("To review", { exact: true });
      await expect(reviewLabel).toBeVisible({ timeout: 20_000 });
      const reviewValue = reviewLabel.locator("xpath=following-sibling::div").first();
      await expect(reviewValue).toHaveText(/^[1-9]\d*$/);
    } finally {
      await seeded.dispose();
    }
  });
});
