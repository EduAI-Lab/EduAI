/**
 * QM admin dashboard (#2119): admin subtitle, admin glance and the
 * "All drafts" shortcut into the Library.
 */
import { test, expect } from "@playwright/test";
import { QM_FRONTEND_URL } from "../../playwright.config";
import { createAdmin, signInThroughPage } from "../helpers/auth";

test.describe("Question Maker admin dashboard", () => {
  test("shows the admin glance and All drafts opens the draft Library", async ({
    page,
    playwright,
  }) => {
    const ctx = await playwright.request.newContext();
    try {
      const admin = await createAdmin(ctx, { prefix: "qm-dash-admin" });
      await signInThroughPage(page, admin, `${QM_FRONTEND_URL}/dashboard`);

      await expect(page.getByText("Your platform's courses and question writing.")).toBeVisible();
      await expect(page.getByText("Reviewed variants", { exact: true })).toBeVisible();
      await expect(page.getByText("AI models", { exact: true })).toBeVisible();

      await page.getByRole("link", { name: /^All drafts/ }).click();
      await expect(page).toHaveURL(/\/library\?status=draft/);
      await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
    } finally {
      await ctx.dispose();
    }
  });
});
