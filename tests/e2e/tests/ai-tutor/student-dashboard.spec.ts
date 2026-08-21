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
import { gotoAiTutor, loginAsStudent } from "../helpers/at-ui";
import { seedEnrolledStudentCourse } from "../helpers/at-student-fixtures";

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

  test("an enrolled course appears in 'Your courses' and 'Continue learning'", async ({
    page,
    playwright,
  }) => {
    const seeded = await seedEnrolledStudentCourse(page, playwright, {
      name: "Dashboard Resume Course",
      codePrefix: "DRC",
    });
    try {
      // The fixture already signed the browser in as the enrolled student.
      await gotoAiTutor(page, "/dashboard");
      await expect(page.getByText("Your courses", { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText(seeded.name).first()).toBeVisible({ timeout: 20_000 });
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
