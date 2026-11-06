/**
 * QM instructor dashboard (#2119): Canvas-style course card, Needs attention,
 * At a glance and the remembered card/list toggle.
 */
import { test, expect } from "@playwright/test";
import { QM_FRONTEND_URL } from "../../playwright.config";
import { createInstructor, signInThroughPage } from "../helpers/auth";
import { createQmCourseForInstructor } from "../helpers/qm-courses";

test.describe("Question Maker instructor dashboard", () => {
  test("shows the course card, attention row, glance and remembered list view", async ({
    page,
    playwright,
  }) => {
    const ctx = await playwright.request.newContext();
    try {
      const instructor = await createInstructor(ctx, { prefix: "qm-dash-instr" });
      const name = `QM Dash Course ${Date.now()}`;
      const { qmCourseId } = await createQmCourseForInstructor(playwright, ctx, {
        name,
        code: "QMDASH",
      });

      await signInThroughPage(page, instructor, `${QM_FRONTEND_URL}/dashboard`);

      await expect(page.getByRole("heading", { name: /^Welcome back/ })).toBeVisible();
      await expect(page.getByText("Your courses and question writing.")).toBeVisible();

      const card = page.locator(`article[data-course-id="${qmCourseId}"]`);
      await expect(card).toBeVisible();

      // Section links: Questions, Banks, Assessments, and no Canvas (course is not linked).
      const sections = card.getByRole("navigation", { name: /sections$/ });
      for (const label of ["Questions", "Banks", "Assessments"]) {
        await expect(sections.getByRole("link", { name: label })).toBeVisible();
      }
      await expect(sections.getByRole("link", { name: "Canvas" })).toHaveCount(0);

      // The overflow menu lists three items and closes on Escape.
      await card.getByRole("button", { name: /actions$/ }).click();
      for (const label of ["Open course", "Questions", "Assessments"]) {
        await expect(page.getByRole("menuitem", { name: label })).toBeVisible();
      }
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menuitem")).toHaveCount(0);

      // Needs attention: the empty course points at its Questions tab.
      await page
        .getByRole("link", { name: /^Open: .*has no questions yet/ })
        .first()
        .click();
      await expect(page).toHaveURL(new RegExp(`/courses/${qmCourseId}\\?tab=questions`));

      await page.goto(`${QM_FRONTEND_URL}/dashboard`);
      await expect(page.getByText("Courses teaching", { exact: true })).toBeVisible();
      await expect(page.getByText("Drafts waiting", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("navigation", { name: "Global" }).getByRole("link", { name: "Bug reports" }),
      ).toHaveCount(0);

      // The card title links to the course workspace.
      await card
        .getByRole("heading", { level: 3 })
        .getByRole("link", { name: new RegExp(name) })
        .click();
      await expect(page).toHaveURL(new RegExp(`/courses/${qmCourseId}(\\?|$)`));

      // The list toggle survives a reload.
      await page.goto(`${QM_FRONTEND_URL}/dashboard`);
      await page.getByLabel("List view").click();
      await expect(page.getByText("Last updated", { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByText("Last updated", { exact: true })).toBeVisible();
    } finally {
      await ctx.dispose();
    }
  });
});
