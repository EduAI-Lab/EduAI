/**
 * QM unit-admin dashboard (#2119).
 *
 * shortcut: there is no in-unit QM course fixture (unit grants arrive through
 * the throttled access mirror), so the "Courses you teach" / "Courses in
 * {unit}" section split is covered in qmDashboardModel.test.ts, not here.
 */
import { test, expect } from "@playwright/test";
import { QM_FRONTEND_URL } from "../../playwright.config";
import { createUnitAdmin, signInThroughPage } from "../helpers/auth";

test.describe("Question Maker unit-admin dashboard", () => {
  test("shows the unit-admin subtitle and glance, without Bug reports", async ({
    page,
    playwright,
  }) => {
    const ctx = await playwright.request.newContext();
    try {
      const unitAdmin = await createUnitAdmin(ctx, { prefix: "qm-dash-ua" });
      await signInThroughPage(page, unitAdmin, `${QM_FRONTEND_URL}/dashboard`);

      await expect(page.getByRole("heading", { name: /^Welcome back/ })).toBeVisible();
      await expect(page.getByText("Your unit's courses and question writing.")).toBeVisible();
      await expect(page.getByText("Unit courses", { exact: true })).toBeVisible();
      await expect(page.getByText("Courses you teach", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("navigation", { name: "Global" }).getByRole("link", { name: "Bug reports" }),
      ).toHaveCount(0);
    } finally {
      await ctx.dispose();
    }
  });
});
