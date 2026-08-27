/**
 * AI Tutor — a TA grades a student's submission, through the browser.
 *
 * This is the TA's flagship staff-AI-adjacent path: `canGradeSubmissions` is
 * true for a TA, and the Submissions tab offers the same Grade dialog an
 * instructor sees — the question, the student's submitted answer, and the AI's
 * own verdict, then a manual override.
 *
 * Regression guard for BUG-TA-1 (see the TA section of the workflow doc): a TA's
 * *platform* role is STUDENT (Core has no `UserRole.TA`), so the activity-level
 * grade authorization must verify the TA *enrolment* role explicitly. It used to
 * call `getLiveStudentEnrollment(res, course, authUser)` with no expected role,
 * which defaulted the allow-list to `["STUDENT"]` and 403'd every TA — the UI
 * offered a Grade button whose Save always failed. Fixed in
 * `server/src/routes/activities.js` by passing `"TA"` as the expected role.
 *
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md` (TA).
 */
import { test, expect, type Page } from "@playwright/test";
import { gotoAiTutor, openTab } from "../helpers/at-ui";
import { registerStudent, seedPublishedCourseAndEnroll } from "../helpers/at-student-fixtures";
import { seedStudentSubmission } from "../helpers/at-admin-fixtures";

type Pw = { request: { newContext: () => Promise<import("@playwright/test").APIRequestContext> } };

async function seedTaWithSubmission(page: Page, playwright: Pw, codePrefix: string) {
  const { studentId } = await registerStudent(page);
  const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
    name: "TA Grading Course",
    codePrefix,
    role: "TA",
  });
  // answerOption 1 is the *wrong* choice, so the attempt auto-grades Incorrect —
  // an override to Correct is a real, observable change.
  const submitter = await seedStudentSubmission(playwright, seeded, seeded.activityId, {
    answerOption: 1,
  });
  return { studentId, seeded, submitter };
}

test.describe("AI Tutor TA — grading", () => {
  test("the Submissions tab shows the grading counters and a gradable row", async ({
    page,
    playwright,
  }) => {
    const { seeded, submitter } = await seedTaWithSubmission(page, playwright, "TG1");
    try {
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);
      await openTab(page, "Submissions");
      for (const counter of ["Submissions", "Needs grading", "Correct", "Pass rate"]) {
        await expect(page.getByText(counter, { exact: false }).first()).toBeVisible({
          timeout: 20_000,
        });
      }
      await expect(page.getByText(submitter.studentName).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /^Grade/ }).first()).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });

  test("a TA overrides an auto-graded submission to Correct and the change persists", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTaWithSubmission(page, playwright, "TG2");
    try {
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);
      await openTab(page, "Submissions");

      await page
        .getByRole("button", { name: /^Grade/ })
        .first()
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("OVERRIDE GRADE")).toBeVisible();
      // The dialog surfaces the AI's context before the override: the question
      // and the student's submitted answer.
      await expect(dialog.getByText("Which case stops a recursion?")).toBeVisible();

      // Result is a Radix select — open it and choose Correct.
      await dialog.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "Correct", exact: true }).click();
      await dialog.getByRole("button", { name: /save grade/i }).click();

      // Before the fix this Save 403'd and the dialog stayed open with an error.
      // Now it closes cleanly and the grade sticks.
      await expect(dialog).toBeHidden({ timeout: 20_000 });
      await expect(page.getByText(/could not save the grade/i)).toHaveCount(0);
      await expect(page.getByText(/not authorized/i)).toHaveCount(0);

      // Re-open the row and confirm the override is now Correct.
      await page
        .getByRole("button", { name: /^Grade/ })
        .first()
        .click();
      await expect(page.getByRole("dialog").getByRole("combobox").first()).toContainText(
        "Correct",
        {
          timeout: 20_000,
        },
      );
    } finally {
      await seeded.dispose();
    }
  });

  test("the pass-rate counter follows a manual grade override", async ({ page, playwright }) => {
    const { seeded } = await seedTaWithSubmission(page, playwright, "TG3");
    try {
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);
      await openTab(page, "Submissions");

      await page
        .getByRole("button", { name: /^Grade/ })
        .first()
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "Correct", exact: true }).click();
      await dialog.getByRole("button", { name: /save grade/i }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });

      // The single submission is now Correct, so the pass rate reads 100%.
      await expect(page.getByText("100%").first()).toBeVisible({ timeout: 20_000 });
    } finally {
      await seeded.dispose();
    }
  });
});
