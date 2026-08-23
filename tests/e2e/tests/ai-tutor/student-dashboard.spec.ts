/**
 * AI Tutor — STUDENT dashboard workflows, driven through the browser.
 *
 * `/dashboard` is the shared landing page for every role (`role-routing.ts`);
 * for a STUDENT it renders `DashboardStudentView`: a four-stat row, the
 * course-status donut + lessons-completed meter, "Your courses", the
 * "Continue learning" resume panel, and three quick actions.
 *
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md`.
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_API_URL } from "../../playwright.config";
import { gotoAiTutor, loginAsStudent } from "../helpers/at-ui";
import { seedMcqActivity } from "../helpers/at-admin-fixtures";
import { seedEnrolledStudentCourse } from "../helpers/at-student-fixtures";

const AT = AI_TUTOR_API_URL;

test.describe("AI Tutor STUDENT — dashboard overview", () => {
  test("shows the four-stat row", async ({ page }) => {
    await loginAsStudent(page, "at-student-dash-stats");
    for (const label of ["Courses enrolled", "In progress", "Completed", "Correct answers"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    }
  });

  test("shows the course-status donut and lessons-completed meter", async ({ page }) => {
    await loginAsStudent(page, "at-student-dash-analytics");
    await expect(page.getByText("Course status", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Lessons completed", { exact: true })).toBeVisible();
    // With no enrolments the donut collapses to its empty copy rather than a
    // zero-slice chart.
    await expect(page.getByText("No enrolled courses yet.")).toBeVisible();
  });

  test("an in-progress course appears in both 'Your courses' and the 'Continue learning' resume panel", async ({
    page,
    playwright,
  }) => {
    const seeded = await seedEnrolledStudentCourse(page, playwright, {
      name: "Dashboard Resume Course",
      codePrefix: "DRC",
    });
    try {
      // "Continue learning" requires *partial* progress: `0 < completed < total`
      // (dashboard-helpers `inProgressCourses`). The fixture seeds one activity,
      // and progress `total` counts every activity in a published lesson while a
      // newly added activity needs no publish of its own — so add a second
      // activity (total → 2), then answer only the first correctly as the
      // signed-in student (completed → 1). 1/2 lands the course in-progress; a
      // single 1/1 would read as "completed" and never surface here.
      await seedMcqActivity(seeded.admin, seeded.lessonId, seeded.topicIds[0], {
        question: "Second activity — leave this one unanswered.",
      });
      // The fixture signed the browser in as the enrolled student, so its request
      // context carries that session. Seed default: correct answer is Option A (0).
      const answer = await page.request.post(`${AT}/api/questions/${seeded.activityId}/answer`, {
        data: { answerOption: 0 },
      });
      expect(answer.status()).toBe(200);
      expect((await answer.json()).isCorrect).toBe(true);

      await gotoAiTutor(page, "/dashboard");

      // "Your courses" lists the enrolment.
      await expect(page.getByText("Your courses", { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText(seeded.name).first()).toBeVisible({ timeout: 20_000 });

      // The resume panel is genuinely populated, not its "Nothing in progress"
      // empty state. The resume hero is a button carrying the course name, the
      // "In progress" badge, and the 1 / 2 progress readout.
      await expect(page.getByText("Nothing in progress")).toHaveCount(0);
      const resume = page.getByRole("button", { name: new RegExp(seeded.name) });
      await expect(resume).toBeVisible({ timeout: 20_000 });
      await expect(resume).toContainText("In progress");
      await expect(resume).toContainText("1 / 2");

      // Exercise the resume link — it drills into the course.
      await resume.click();
      await expect(page).toHaveURL(new RegExp(`/student/courses/${seeded.atCourseId}(\\b|/|$)`), {
        timeout: 20_000,
      });
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor STUDENT — dashboard quick actions", () => {
  const actions: Array<[string, RegExp]> = [
    ["View courses", /\/student$/],
    ["Open settings", /\/settings$/],
  ];

  for (const [label, url] of actions) {
    test(`"${label}" navigates to its destination`, async ({ page }) => {
      await loginAsStudent(page, "at-student-dash-quick");
      await expect(page.getByText("Quick actions")).toBeVisible({ timeout: 20_000 });
      await page
        .getByRole("link", { name: new RegExp(label, "i") })
        .first()
        .click();
      await expect(page).toHaveURL(url, { timeout: 20_000 });
    });
  }
});
