/**
 * AI Tutor UNIT_ADMIN — settings workflows (browser-driven).
 *
 * `/settings` is role-neutral: every authenticated role gets the same three
 * tabs. It is included in the unit-admin sweep because it is one of the four
 * destinations the role can actually reach, and because the Providers tab is
 * where the admin supplies the model key their own AI tutoring sessions use.
 *
 * Nothing here is admin configuration — AI *policy* lives in `/admin` and is
 * ADMIN-only (see unit-admin-admin-console.spec.ts); these keys are personal
 * and browser-local.
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { AI_TUTOR_URL } from "../../playwright.config";
import { signInThroughPage } from "../helpers/auth";
import { openTab } from "../helpers/at-ui";
import { createUnitAdmin, type UnitAdminFixture } from "../helpers/at-unit-admin";

let ua: UnitAdminFixture;

test.beforeAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  try {
    ua = await createUnitAdmin(playwright, ctx);
  } finally {
    await ctx.dispose();
  }
});

test.afterAll(async () => {
  await ua?.dispose();
});

/** A provider's key input, addressed by its own placeholder. */
function providerKeyField(page: Page, label: string): Locator {
  return page.getByPlaceholder(`Enter your ${label} API key`);
}

/**
 * The Save button belonging to `label`'s row.
 *
 * Every provider renders its own identically-named Save, so an unscoped
 * `getByRole("button", { name: "Save" })` picks an arbitrary one — filling
 * OpenAI's field and then asserting on OpenCode Go's button looks like a
 * product bug when it is only a mis-aimed locator. `.last()` resolves to the
 * innermost wrapper holding both the field and its button.
 */
function providerSaveButton(page: Page, label: string): Locator {
  return page
    .locator("div")
    .filter({ has: providerKeyField(page, label) })
    .last()
    .getByRole("button", { name: "Save" });
}

/**
 * A density/theme radio, addressed by the stable id `AccessibilitySettings`
 * gives it (`density-comfortable`, `theme-dark`, …).
 *
 * The accessible name works too, but these are Radix `RadioGroupItem`s — real
 * `<button role="radio">` elements re-rendered on every value change — and
 * keying on the id keeps the locator stable across that churn while a click and
 * its resulting `aria-checked` flip settle.
 */
function settingsRadio(page: Page, id: string): Locator {
  return page.locator(`#${id}`);
}

/**
 * Choose one density option and confirm the other clears.
 *
 * The preference is persisted, so a click landing before the control is wired
 * up is silently dropped — drive it until the state actually flips.
 */
async function selectDensity(option: Locator, other: Locator) {
  await expect(async () => {
    await option.click({ timeout: 3_000 });
    await expect(option).toBeChecked({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  await expect(other).not.toBeChecked();
}

test.describe("UNIT_ADMIN settings", () => {
  test("the Account tab shows the signed-in unit admin's profile", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/settings`);

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByText("Your account details for this AI Tutor session.")).toBeVisible();
    await expect(page.getByText(ua.email).first()).toBeVisible();
    // The role badge is rendered from the session, so it is a second read of
    // the role having survived Core -> AI Tutor validation.
    await expect(page.getByText("Unit Admin").first()).toBeVisible();
  });

  test("all three settings tabs are available", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/settings`);

    await expect(page.getByRole("tab")).toHaveCount(3);
    for (const tab of ["Account", "Accessibility", "Providers"]) {
      await expect(page.getByRole("tab", { name: tab })).toBeVisible();
    }
  });

  test("the Accessibility tab exposes the personalization controls", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/settings`);
    await openTab(page, "Accessibility");

    // Assistive Mode is a Switch, not a heading — match the control the
    // shared AccessibilitySettings panel actually mounts once the tab is
    // selected. A bare click before PageTabs hydrates is swallowed and then
    // this assertion fails against the still-mounted Account panel.
    await expect(page.getByRole("switch", { name: "Assistive Mode" })).toBeVisible();
    await expect(page.getByText("Minimize animations and transitions.")).toBeVisible();
    await expect(
      page.getByText("Choose a more compact or comfortable layout spacing."),
    ).toBeVisible();
    await expect(page.getByText("Match your device or choose light or dark.")).toBeVisible();
  });

  test("the density control switches between comfortable and compact", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/settings`);
    await openTab(page, "Accessibility");
    await expect(
      page.getByText("Choose a more compact or comfortable layout spacing."),
    ).toBeVisible();

    // Density is a radio group, so the two options are mutually exclusive. The
    // starting value is whatever this browser profile last persisted, so assert
    // the switch rather than a particular default.
    const compact = settingsRadio(page, "density-compact");
    const comfortable = settingsRadio(page, "density-comfortable");

    await selectDensity(compact, comfortable);
    await selectDensity(comfortable, compact);
  });

  test("the accessibility radios are properly named for assistive tech", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/settings`);
    await openTab(page, "Accessibility");
    await expect(
      page.getByText("Choose a more compact or comfortable layout spacing."),
    ).toBeVisible();

    // Each option is a Radix `<button role="radio">` inside a `<Label htmlFor=…>`
    // whose text sits in a sibling `<span>`. The browser does compute the name
    // from that association, so all five options announce correctly — worth
    // pinning on the accessibility screen specifically.
    await expect(page.getByRole("radio")).toHaveCount(5);
    for (const name of ["Comfortable", "Compact", "System", "Light", "Dark"]) {
      await expect(page.getByRole("radio", { name, exact: true })).toHaveCount(1);
    }
  });

  test("the Providers tab offers per-user model keys", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/settings`);
    await openTab(page, "Providers");

    // Keys are per-account and browser-local; they leave the browser only to be
    // validated or used, and are never persisted server-side. That is the
    // difference from the ADMIN-only platform key in /admin.
    await expect(page.getByText(/Keys are stored for this account in this browser/)).toBeVisible();
    await expect(page.getByText(/Signing out removes them from this browser/)).toBeVisible();

    for (const provider of ["Gemini", "OpenAI", "OpenCode Go"]) {
      await expect(providerKeyField(page, provider)).toBeVisible();
    }
    // Save stays disabled until a key is actually entered.
    await expect(providerSaveButton(page, "OpenAI")).toBeDisabled();
  });

  test("a provider key is validated before it is stored", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/settings`);
    await openTab(page, "Providers");

    const field = providerKeyField(page, "OpenAI");
    const save = providerSaveButton(page, "OpenAI");

    await expect(field).toBeVisible();
    await field.fill("sk-not-a-real-key-e2e");
    await expect(save).toBeEnabled();
    await save.click();

    // The key is checked with the provider before being written, so a bad key
    // is reported rather than silently accepted — and the row stays in its
    // unconfigured state instead of flipping to "Connected".
    // The round-trip goes out to the real provider, so give it more than the
    // default assertion window before calling this a failure.
    await expect(
      page.getByText(/Invalid API key|Could not validate API key|Incorrect API key/i),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Connected")).toHaveCount(0);
    await expect(field).toBeVisible();
  });

  test("the sign-out card is available from every settings tab", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/settings`);

    for (const tab of ["Account", "Accessibility", "Providers"]) {
      await openTab(page, tab);
      await expect(page.getByText("Sign out of EduAI on this browser.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
    }
  });
});
