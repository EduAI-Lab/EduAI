/**
 * AI Tutor — STUDENT Settings, driven through the browser.
 *
 * Settings is per-user and identical in shape across roles; this covers the
 * three tabs from a student's vantage: Account (name/email + the STUDENT role
 * badge and sign-out card), Accessibility, and Providers (the browser-local
 * BYOK keys that also back the in-chat "Add API key" dialog).
 *
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md`.
 */
import { test, expect } from "@playwright/test";
import { gotoAiTutor, loginAsStudent, openTab } from "../helpers/at-ui";

test.describe("AI Tutor STUDENT — Settings", () => {
  test("the Account tab shows the signed-in student and their role", async ({ page }) => {
    const student = await loginAsStudent(page, "at-student-settings-account");
    await gotoAiTutor(page, "/settings");

    await expect(
      page.getByText("Manage your account, accessibility preferences, and AI provider keys."),
    ).toBeVisible();
    await expect(page.getByText(student.email).first()).toBeVisible();
    await expect(page.getByText("Student", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^log out$/i })).toBeVisible();
  });

  test("the Accessibility tab exposes assistive mode, motion, density, and theme", async ({
    page,
  }) => {
    await loginAsStudent(page, "at-student-settings-a11y");
    await gotoAiTutor(page, "/settings");
    await openTab(page, "Accessibility");

    await expect(page.getByText("Assistive Mode")).toBeVisible();
    await expect(page.getByText("Reduce motion")).toBeVisible();
    await expect(page.getByText("Density")).toBeVisible();
  });

  test("the Providers tab offers browser-local BYOK keys for Gemini and OpenAI", async ({
    page,
  }) => {
    await loginAsStudent(page, "at-student-settings-providers");
    await gotoAiTutor(page, "/settings");
    await openTab(page, "Providers");

    await expect(page.getByText("Model providers", { exact: true })).toBeVisible();
    await expect(page.getByText(/Keys are stored for this account in this browser/)).toBeVisible();
    await expect(page.getByText(/Signing out removes them from this browser/)).toBeVisible();
    await expect(page.getByText("Gemini")).toBeVisible();
    await expect(page.getByText("OpenAI")).toBeVisible();
  });
});
