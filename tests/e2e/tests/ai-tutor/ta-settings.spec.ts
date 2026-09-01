/**
 * AI Tutor — TA Settings, driven through the browser.
 *
 * Settings is per-user and identical in shape across roles; this covers the
 * three tabs from a TA's vantage: Account (name/email + role indicator and the
 * sign-out card), Accessibility, and Providers (browser-local BYOK keys, the
 * same store the in-chat "Add API key" dialog writes). The only role-specific
 * bit is the account role label — `getRoleViewLabel("TA")` is "Teaching
 * assistant".
 *
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md` (TA).
 */
import { test, expect, type Page } from "@playwright/test";
import { AI_TUTOR_API_URL } from "../../playwright.config";
import { gotoAiTutor, openTab } from "../helpers/at-ui";
import { registerStudent, seedPublishedCourseAndEnroll } from "../helpers/at-student-fixtures";

type Pw = { request: { newContext: () => Promise<import("@playwright/test").APIRequestContext> } };

async function seedTa(page: Page, playwright: Pw, codePrefix = "TSE") {
  const { studentId } = await registerStudent(page);
  const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
    name: "TA Settings Course",
    codePrefix,
    role: "TA",
  });
  return { studentId, seeded };
}

test.describe("AI Tutor TA — Settings", () => {
  test("the Account tab shows the TA identity, a TA role indicator, and sign-out", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTa(page, playwright, "TS1");
    try {
      await gotoAiTutor(page, "/settings");
      await expect(
        page.getByText("Manage your account, accessibility preferences, and AI provider keys."),
      ).toBeVisible({ timeout: 20_000 });

      const me = await (await page.request.get(`${AI_TUTOR_API_URL}/api/me`)).json();
      await expect(page.getByText(me.user.email).first()).toBeVisible();
      // The effective role is TA; the account surface labels it (raw "TA" chip or
      // the "Teaching assistant" long form).
      await expect(page.getByText(/Teaching assistant|TA/).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /^log out$/i })).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });

  test("the Accessibility tab exposes assistive mode, motion, and density", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTa(page, playwright, "TS2");
    try {
      await gotoAiTutor(page, "/settings");
      await openTab(page, "Accessibility");
      await expect(page.getByText("Assistive Mode")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("Reduce motion")).toBeVisible();
      await expect(page.getByText("Density")).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });

  test("the Providers tab offers Core-backed BYOK keys for Gemini and OpenAI", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTa(page, playwright, "TS3");
    try {
      await gotoAiTutor(page, "/settings");
      await openTab(page, "Providers");
      await expect(page.getByText("Model providers", { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText(/stored securely in Core for this account/)).toBeVisible();
      await expect(page.getByText("Gemini")).toBeVisible();
      await expect(page.getByText("OpenAI")).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });
});
