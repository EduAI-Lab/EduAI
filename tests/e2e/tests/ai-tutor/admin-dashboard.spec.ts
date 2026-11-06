/**
 * AI Tutor — ADMIN dashboard workflows, driven through the browser.
 *
 * `/dashboard` is the shared landing page for every role (`role-routing.ts`);
 * for ADMIN it renders `AdminDashboard`: Core's admin dashboard layout with AI
 * Tutor data — courses and content & tutoring totals, "Needs your attention",
 * AI tutor health, weekly tutoring sessions, a courses preview, recent tutor
 * replies, and an inline Getting started checklist.
 *
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md`.
 */
import { test, expect } from "@playwright/test";
import { loginAsAdmin, openBugReport } from "../helpers/at-ui";
import { seedAtCourse } from "../helpers/at-admin-fixtures";

test.describe("AI Tutor ADMIN — dashboard overview", () => {
  test("shows the cards in Core's admin layout, about AI Tutor only", async ({ page }) => {
    await loginAsAdmin(page, "at-admin-dash-cards");

    await expect(page.getByText("Platform overview")).toBeVisible();
    for (const name of [
      "Courses",
      "Content & tutoring",
      "Needs your attention",
      "AI tutor health",
      "Usage",
      "Recent AI activity",
    ]) {
      await expect(page.getByRole("heading", { name, exact: true }).first()).toBeVisible({
        timeout: 20_000,
      });
    }
    // Users are managed in Core, so the AI Tutor dashboard has no user rollup.
    await expect(page.getByRole("heading", { name: "Users by role" })).toHaveCount(0);
    await expect(page.getByText(/couldn't load/i)).toHaveCount(0);
  });

  test("reports the AI tutor's health with a status per row", async ({ page }) => {
    await loginAsAdmin(page, "at-admin-dash-health");

    for (const name of ["EduAI API key", "Model catalog (Core)", "Tutor model", "Reviewer model"]) {
      await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 20_000 });
    }
    await page.getByRole("link", { name: /view ai settings/i }).click();
    await expect(page).toHaveURL(/\/admin\?tab=ai-settings$/, { timeout: 20_000 });
    await expect(
      page
        .getByRole("navigation", { name: "Administration" })
        .getByRole("link", { name: "AI settings", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("lists a course owned by another instructor and links to the full list", async ({
    page,
    playwright,
  }) => {
    const seeded = await seedAtCourse(playwright, {
      name: "Dashboard Panel Course",
      codePrefix: "DASHP",
    });
    try {
      await loginAsAdmin(page, "at-admin-dash-courses");

      await expect(page.getByText(seeded.name).first()).toBeVisible({ timeout: 20_000 });
      await page
        .getByRole("link", { name: /view all/i })
        .first()
        .click();
      await expect(page).toHaveURL(/\/instructor/);
    } finally {
      await seeded.dispose();
    }
  });

  test("opens AI oversight from Recent AI activity", async ({ page }) => {
    await loginAsAdmin(page, "at-admin-dash-oversight");

    await page.getByRole("link", { name: /all interactions/i }).click();
    await expect(page).toHaveURL(/\/admin\?tab=ai-oversight$/, { timeout: 20_000 });
    await expect(
      page
        .getByRole("navigation", { name: "Administration" })
        .getByRole("link", { name: "AI oversight", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });
});

test.describe("AI Tutor ADMIN — needs your attention", () => {
  test("counts a report submitted from the shell and opens bug-report triage", async ({ page }) => {
    await loginAsAdmin(page, "at-admin-dash-triage");

    const description = `E2E dashboard triage probe ${Date.now()}`;
    await openBugReport(page);
    const dialog = page.getByRole("dialog", { name: "Report a bug" });
    await dialog.getByTestId("bug-type").click();
    await page.locator('[role="option"]').first().click();
    await dialog.getByTestId("bug-description").fill(description);
    await dialog.getByRole("button", { name: /submit report/i }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    await page.reload();
    // The queue is platform-wide, so other runs' reports count too: at least ours.
    const row = page.getByRole("link", { name: /unhandled bug reports/i });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).not.toContainText("No reports waiting");

    await row.click();
    await expect(page).toHaveURL(/\/admin\?tab=bug-reports$/, { timeout: 20_000 });
    await expect(page.getByText(description)).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("AI Tutor ADMIN — dashboard course-list bound", () => {
  test("discloses the truncation rather than ending the list silently", async ({
    page,
    playwright,
  }) => {
    // The Courses card shows a 4-course preview; #1208 requires the bound to be
    // stated. Seed enough courses that the notice must appear.
    const seeded = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        seedAtCourse(playwright, { name: `Bound Course ${i + 1}`, codePrefix: `BND${i + 1}` }),
      ),
    );
    try {
      await loginAsAdmin(page, "at-admin-dash-bound");
      await expect(page.getByText(/Showing 4 of \d+ courses/i)).toBeVisible({ timeout: 20_000 });
    } finally {
      await Promise.all(seeded.map((s) => s.dispose()));
    }
  });
});
