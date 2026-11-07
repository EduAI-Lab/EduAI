/**
 * AI Tutor — the TA dashboard variant, driven through the browser.
 *
 * Every role lands on the shared `/dashboard` (`role-routing.ts`), which renders
 * a role-specific view. A TA gets neither the student's four-stat learner row
 * nor the instructor's teaching rollup, but a "Courses you assist" grid (the
 * shared `TeachingDashboard`) fed by the `{ role: "TA", yourCourses, publishedCourses,
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
  test("the dashboard renders the TA 'Courses you assist' variant", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTaDashboard(page, playwright, "TDA");
    try {
      await gotoAiTutor(page, "/dashboard");
      // The section and subtitle are TA-specific — not the student's
      // "Continue where you left off" nor the instructor rollup.
      await expect(page.getByRole("region", { name: "Courses you assist" })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText("Your assigned courses and student activity.")).toBeVisible();
      // A TA can't publish, so there is no drafts panel.
      await expect(page.getByRole("region", { name: "At a glance" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Needs attention" })).toHaveCount(0);
    } finally {
      await seeded.dispose();
    }
  });

  test("an assigned course appears in the Courses you assist section", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTaDashboard(page, playwright, "TDB");
    try {
      await gotoAiTutor(page, "/dashboard");
      const link = page
        .getByRole("region", { name: "Courses you assist" })
        .getByRole("link", { name: new RegExp(`^${seeded.code} · `) });
      await expect(link).toBeVisible({ timeout: 20_000 });
      await expect(link).toHaveAttribute("href", `/instructor/courses/${seeded.atCourseId}`);
    } finally {
      await seeded.dispose();
    }
  });

  test("the course card offers the TA's sections and Content opens the staff view", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTaDashboard(page, playwright, "TDC");
    try {
      await gotoAiTutor(page, "/dashboard");
      const sections = page.getByRole("navigation", { name: `${seeded.code} sections` });
      await expect(sections.getByRole("link", { name: "Submissions" })).toBeVisible({
        timeout: 20_000,
      });
      // #1660: a TA has a real student view, so no "Preview as student".
      await expect(sections.getByRole("link", { name: "Preview as student" })).toHaveCount(0);
      await sections.getByRole("link", { name: "Content" }).click();
      await expect(page).toHaveURL(new RegExp(`/instructor/courses/${seeded.atCourseId}$`), {
        timeout: 20_000,
      });
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
      // non-empty. MCQ auto-grades on submit, so it never enters the
      // `isCorrect: null` queue — a SHORT_TEXT activity (never auto-graded) is
      // the realistic source. A student submits a text answer to it,
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
      await expect(
        page.getByRole("link", { name: new RegExp(`^${seeded.code} · `) }).first(),
      ).toBeVisible({ timeout: 20_000 });

      // "At a glance" is a <dl>: assert the <dd> beside "To review" is non-zero.
      const glance = page.getByRole("region", { name: "At a glance" });
      const reviewLabel = glance.getByText("To review", { exact: true });
      await expect(reviewLabel).toBeVisible({ timeout: 20_000 });
      const reviewValue = reviewLabel.locator("xpath=following-sibling::dd").first();
      await expect(reviewValue).toHaveText(/^[1-9]\d*$/);
    } finally {
      await seeded.dispose();
    }
  });
});
