/**
 * AI Tutor INSTRUCTOR — settings workflows (browser-driven).
 *
 * `/settings` is open to every authenticated role because every tab on it is
 * per-user: Account, Accessibility, and the personal AI provider keys. It is
 * deliberately *not* where an instructor configures anything about a course —
 * platform-wide AI configuration lives on the ADMIN-only `/admin` console, and
 * per-activity AI behaviour lives on the lesson page.
 *
 * The provider keys matter to this role in particular: the AI Study Buddy modes
 * an instructor enables per activity need a provider behind them, and the key
 * that supplies one is entered here.
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_URL } from "../../playwright.config";
import { signInThroughPage } from "../helpers/auth";
import { createTeachingInstructor, type InstructorFixture } from "../helpers/at-instructor";
import { gotoAiTutor, openTab } from "../helpers/at-ui";

let fx: InstructorFixture;

test.beforeAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  try {
    fx = await createTeachingInstructor(playwright, ctx);
  } finally {
    await ctx.dispose();
  }
});

test.afterAll(async () => {
  await fx?.dispose();
});

test.describe("INSTRUCTOR settings", () => {
  test("the Account tab shows this instructor's identity and role", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, "/settings");

    await openTab(page, "Account");
    // Scoped to the tab panel: the sidebar footer shows the same email, so a
    // page-wide match would pass even if the panel rendered nothing.
    const panel = page.getByLabel("Account");
    await expect(page.getByText("Your account details for this AI Tutor session.")).toBeVisible();
    await expect(panel.getByText(fx.email)).toBeVisible();
    // The role is stated, not inferred — the same claim the sidebar badge makes.
    await expect(panel.getByText("Instructor", { exact: true }).first()).toBeVisible();
  });

  test("settings offers exactly the three per-user tabs", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, "/settings");

    const tabs = await page.getByRole("tab").allInnerTexts();
    // No AI-configuration tab: that is ADMIN-only and lives on /admin.
    expect(tabs.map((t) => t.trim())).toEqual(["Account", "Accessibility", "Providers"]);
  });

  test("switches layout density both ways", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, "/settings");
    await openTab(page, "Accessibility");

    // Radix renders these as `<button role="radio">` named via a wrapping
    // `<Label htmlFor>`, so they are addressable by their visible label rather
    // than only by position.
    const compact = page.getByRole("radio", { name: "Compact" });
    await expect(compact).toBeVisible();
    await compact.click();
    await expect(compact).toBeChecked();
    // The choice takes effect immediately — it is applied to the document, not
    // only recorded in the control.
    await expect(page.locator("html")).toHaveAttribute("data-density", "compact");

    // Not a one-way door.
    await page.getByRole("radio", { name: "Comfortable" }).click();
    await expect(page.getByRole("radio", { name: "Comfortable" })).toBeChecked();
    await expect(page.locator("html")).not.toHaveAttribute("data-density", "compact");
  });

  test("density and reduce motion survive a reload", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, "/settings");
    await openTab(page, "Accessibility");

    await page.getByRole("radio", { name: "Compact" }).click();
    await expect(page.getByRole("radio", { name: "Compact" })).toBeChecked();
    const reduceMotion = page.getByRole("switch", { name: "Reduce motion" });
    await reduceMotion.click();
    await expect(reduceMotion).toHaveAttribute("aria-checked", "true");

    await page.reload();

    // Both are re-applied before the Settings screen is even opened —
    // `UiPreferencesProvider` is mounted at the root, so the preference holds
    // app-wide rather than only while this screen happens to be rendered.
    await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
    await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "true");

    await openTab(page, "Accessibility");

    // …and the controls come back showing the stored choice, like theme and
    // assistive mode already did. These two used to be the outliers: they lived
    // only as `data-*` attributes on `documentElement`, read back from there,
    // so a reload reset them.
    await expect(page.getByRole("radio", { name: "Compact" })).toBeChecked({ timeout: 30_000 });
    await expect(page.getByRole("radio", { name: "Comfortable" })).not.toBeChecked();
    await expect(page.getByRole("switch", { name: "Reduce motion" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("chooses a theme from the accessibility tab", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, "/settings");
    await openTab(page, "Accessibility");

    // Three states, including "System" — the default is to follow the device
    // rather than to pick for the user.
    for (const name of ["System", "Light", "Dark"]) {
      await expect(page.getByRole("radio", { name })).toBeVisible();
    }
    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  });

  test("toggles assistive mode and reduce motion", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, "/settings");
    await openTab(page, "Accessibility");

    // Both are stated as optional for everyone, not framed as an accommodation
    // the reader has to justify.
    await expect(page.getByText("These settings are optional for everyone.")).toBeVisible();

    // Both switches carry an explicit `aria-label`, so each is addressable on
    // its own rather than by position in the panel.
    const assistive = page.getByRole("switch", { name: "Assistive Mode" });
    const assistiveBefore = await assistive.getAttribute("aria-checked");
    await assistive.click();
    await expect(assistive).not.toHaveAttribute("aria-checked", assistiveBefore ?? "");

    // Reduce motion is the other half of this row and moves independently —
    // toggling one must not carry the other with it.
    const reduceMotion = page.getByRole("switch", { name: "Reduce motion" });
    const motionBefore = await reduceMotion.getAttribute("aria-checked");
    await reduceMotion.click();
    await expect(reduceMotion).not.toHaveAttribute("aria-checked", motionBefore ?? "");
    // It reaches the document, same as density, and AI Tutor's `app.css` now
    // carries the rules that read it (ported from Core's).
    await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "true");
    await expect(assistive).not.toHaveAttribute("aria-checked", assistiveBefore ?? "");
  });

  test("the Providers tab is explicit about where a key is stored", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, "/settings");
    await openTab(page, "Providers");

    // `CardTitle` is a styled div, not a heading element.
    await expect(page.getByText("Model providers")).toBeVisible();
    // The copy states the whole lifecycle up front: stored in Core for this
    // account, sent through EduAI services to the provider only when a key is
    // validated or used. A key is credential material, so this cannot be left
    // implicit.
    await expect(page.getByText(/stored securely in Core for this account/)).toBeVisible();
    await expect(page.getByText(/sent through EduAI services/)).toBeVisible();
    for (const provider of ["Gemini", "OpenAI"]) {
      await expect(page.getByText(provider, { exact: true }).first()).toBeVisible();
    }
  });

  test("a bad provider key is rejected rather than silently accepted", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, "/settings");
    await openTab(page, "Providers");

    // The key is validated against the provider before being stored, so an
    // instructor finds out here rather than when a student's chat fails.
    // The input is addressed by its placeholder, which names the provider — the
    // three rows are otherwise structurally identical.
    const input = page.getByPlaceholder("Enter your Gemini API key");
    await input.fill("definitely-not-a-real-api-key");
    await page.getByRole("button", { name: "Save" }).first().click();

    // Reported inline next to the field it belongs to, and the field is marked
    // invalid — the key is not quietly stored for a student's chat to fail on.
    await expect(input).toHaveAttribute("aria-invalid", "true", { timeout: 45_000 });
    await expect(
      page.getByText(/Invalid API key|Could not validate API key|API key/i).last(),
    ).toBeVisible();
  });

  test("a saved key persists in Core across a reload, not just this browser", async ({ page }) => {
    // Stubs the provider-key lifecycle server-side so the test proves the
    // Core-backed persistence contract (survives a reload with a fresh
    // in-memory account state) without depending on a live provider.
    let stored: { providerName: string; isEnabled: boolean; hasKey: boolean } | null = null;
    await page.route("**/api/ai-models/validate-key", async (route) => {
      await route.fulfill({ json: { valid: true } });
    });
    await page.route("**/api/provider-settings", async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        await route.fulfill({ json: stored ? [{ ...stored, baseUrl: null }] : [] });
        return;
      }
      if (method === "POST") {
        const body = route.request().postDataJSON();
        stored = { providerName: body.providerName, isEnabled: true, hasKey: true };
        await route.fulfill({ json: { ok: true } });
        return;
      }
      await route.continue();
    });

    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, "/settings");
    await openTab(page, "Providers");

    const input = page.getByPlaceholder("Enter your Gemini API key");
    await input.fill("stubbed-valid-gemini-key");
    await page.getByRole("button", { name: "Save" }).first().click();
    await expect(page.getByText("Connected").first()).toBeVisible({ timeout: 45_000 });

    // Reload the page — a browser-only implementation would still pass here
    // since localStorage survives a reload, so the real assertion is that the
    // connected state was actually read back from the stubbed Core response,
    // not from any leftover local copy the fix is required to clear.
    await page.reload();
    await openTab(page, "Providers");
    await expect(page.getByText("Connected").first()).toBeVisible({ timeout: 20_000 });
  });
});
