/**
 * QM courses page for an instructor (#2119): heading, search, term caption,
 * card link and list view.
 */
import { test, expect } from "@playwright/test";
import { QM_FRONTEND_URL } from "../../playwright.config";
import { createInstructor, signInThroughPage } from "../helpers/auth";
import { createQmCourseForInstructor } from "../helpers/qm-courses";

test.describe("Question Maker courses page", () => {
  test("instructor can search, open a card and switch to the list view", async ({
    page,
    playwright,
  }) => {
    const ctx = await playwright.request.newContext();
    try {
      const instructor = await createInstructor(ctx, { prefix: "qm-courses-instr" });
      const name = `QM Courses Page ${Date.now()}`;
      const { qmCourseId } = await createQmCourseForInstructor(playwright, ctx, {
        name,
        code: "QMLIST",
      });

      await signInThroughPage(page, instructor, `${QM_FRONTEND_URL}/courses`);

      await expect(page.getByRole("heading", { name: "Courses", exact: true })).toBeVisible();
      await expect(page.getByText("Courses you teach, including ones you co-teach.")).toBeVisible();
      await expect(page.getByText(/(Current|Upcoming|Previous) term/).first()).toBeVisible();

      const search = page.getByPlaceholder("Search courses by title or code");
      await search.fill("no-such-course-xyz");
      await expect(page.getByText("No courses match")).toBeVisible();
      await search.fill(name);
      await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();

      await page.getByLabel("List view").click();
      await expect(page.getByText("Last updated", { exact: true })).toBeVisible();

      await page.getByRole("link", { name: new RegExp(name) }).click();
      await expect(page).toHaveURL(new RegExp(`/courses/${qmCourseId}(\\?|$)`));
      expect(page.url()).not.toContain("tab=overview");
    } finally {
      await ctx.dispose();
    }
  });
});
