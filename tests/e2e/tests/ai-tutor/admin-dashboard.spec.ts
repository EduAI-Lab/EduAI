/**
 * AI Tutor — ADMIN dashboard workflows, driven through the browser.
 *
 * `/dashboard` is the shared landing page for every role (`role-routing.ts`);
 * for ADMIN it renders `DashboardAdminView`: a platform-wide stat row, two
 * rollup donuts, the all-courses panel, quick actions, and bug-report triage.
 *
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md`.
 */
import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../helpers/at-ui";
import { seedAtCourse } from "../helpers/at-admin-fixtures";

test.describe("AI Tutor ADMIN — dashboard overview", () => {
  test("shows the platform-wide stat row", async ({ page }) => {
    await loginAsAdmin(page, "at-admin-dash-stats");

    await expect(page.getByText("Platform overview")).toBeVisible();
    for (const label of ["Total courses", "Published", "Platform users", "Open bug reports"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  test("shows the publish-status and users-by-role rollups", async ({ page }) => {
    await loginAsAdmin(page, "at-admin-dash-donuts");

    await expect(page.getByRole("heading", { name: "Publish status" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Users by role" })).toBeVisible();
    // The role donut is fed by Core's platform-wide stats, so an admin always
    // counts at least themselves — an empty donut here means the rollup broke.
    // The donut centre labels are uppercased in CSS, so match the DOM casing.
    await expect(page.getByText(/^users$/i).first()).toBeVisible();
    await expect(page.getByText(/^courses$/i).first()).toBeVisible();
    await expect(page.getByText("Students", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
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

      await expect(page.getByRole("heading", { name: "All courses" })).toBeVisible();
      await expect(page.getByText(seeded.name).first()).toBeVisible({ timeout: 20_000 });

      await page
        .getByRole("link", { name: /browse all/i })
        .first()
        .click();
      await expect(page).toHaveURL(/\/instructor/);
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor ADMIN — dashboard quick actions", () => {
  const actions: Array<[string, RegExp]> = [
    ["View courses", /\/instructor$/],
    ["Triage bug reports", /\/admin$/],
    ["Open settings", /\/settings$/],
  ];

  for (const [label, url] of actions) {
    test(`"${label}" navigates to its destination`, async ({ page }) => {
      await loginAsAdmin(page, "at-admin-dash-quick");
      // The quick-action panel renders once the stats resolve.
      await expect(page.getByText("Quick actions")).toBeVisible({ timeout: 20_000 });

      await page
        .getByRole("link", { name: new RegExp(label, "i") })
        .first()
        .click();
      await expect(page).toHaveURL(url, { timeout: 20_000 });
    });
  }
});

test.describe("AI Tutor ADMIN — bug-report triage panel", () => {
  test("renders the triage panel in whichever of its two states applies", async ({ page }) => {
    // Honest name: the bug-report queue is platform-wide, so a fresh admin
    // still sees whatever other runs filed. This asserts the panel resolves to
    // one of its two documented states rather than erroring or hanging — it is
    // *not* a test of the empty state, which cannot be forced here.
    await loginAsAdmin(page, "at-admin-dash-triage-empty");

    await expect(page.getByText("Bug reports to triage")).toBeVisible();
    const empty = page.getByText("Nothing to triage");
    const triageCta = page.getByRole("button", { name: /triage report/i });
    await expect(empty.or(triageCta).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/could not load/i)).toHaveCount(0);
  });

  test("a report submitted from the shell appears in the panel and opens triage", async ({
    page,
  }) => {
    await loginAsAdmin(page, "at-admin-dash-triage");

    const description = `E2E dashboard triage probe ${Date.now()}`;
    await page.getByRole("button", { name: /report a bug/i }).click();
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByTestId("bug-type").click();
    await page.locator('[role="option"]').first().click();
    await dialog.getByTestId("bug-description").fill(description);
    await dialog.getByRole("button", { name: /submit report/i }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    await page.reload();
    await expect(page.getByText(description)).toBeVisible({ timeout: 30_000 });

    await page
      .getByRole("button", { name: /triage report/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Admin console" })).toBeVisible();
  });
});

test.describe("AI Tutor ADMIN — dashboard course-list bound", () => {
  test("discloses the truncation rather than ending the list silently", async ({
    page,
    playwright,
  }) => {
    // The dashboard panel shows one short page; #1208 requires the bound to be
    // stated. Seed enough courses that the notice must appear.
    const seeded = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        seedAtCourse(playwright, { name: `Bound Course ${i + 1}`, codePrefix: `BND${i + 1}` }),
      ),
    );
    try {
      await loginAsAdmin(page, "at-admin-dash-bound");
      await expect(page.getByRole("heading", { name: "All courses" })).toBeVisible();
      await expect(page.getByText(/Showing \d+ of \d+ courses/i)).toBeVisible({ timeout: 20_000 });
    } finally {
      await Promise.all(seeded.map((s) => s.dispose()));
    }
  });
});
