/**
 * AI Tutor UNIT_ADMIN — shell and navigation workflows (browser-driven).
 *
 * Every test here drives the real AI Tutor SPA through Chromium: sign in via
 * Core's login form, then click through the app the way a unit admin would.
 *
 * Auth model: AI Tutor has no sign-in of its own. It validates each request by
 * forwarding the caller's cookie to Core's `POST /api/sessions/validate`, and
 * that response is what carries `role` and `authorizedUnits` into the app — so
 * a Core session is both necessary and sufficient (see access.spec.ts).
 *
 * The fixture is built once for the file: it provisions an admin, an
 * instructor and two Core courses, which is far too much setup to repeat per
 * test, and none of these tests mutate it.
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_URL } from "../../playwright.config";
import { signInThroughPage } from "../helpers/auth";
import { createUnitAdmin, type UnitAdminFixture } from "../helpers/at-unit-admin";
import { commandPalette, sidebarHrefs, sidebarLink, userMenuButton } from "../helpers/at-ui";

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

test.describe("UNIT_ADMIN shell and navigation", () => {
  test("signing in lands the unit admin on the role-aware dashboard", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    // heroCopy(UNIT_ADMIN) in routes/dashboard.tsx — proves the role reached
    // the client, not merely that some dashboard rendered.
    await expect(page.getByText("Your unit's courses and administration.")).toBeVisible();
    // The sidebar user card renders the role label from the same session.
    await expect(userMenuButton(page)).toContainText("Unit Admin");
  });

  test("the sidebar exposes Dashboard, Courses and Help — and no Admin entry", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    await expect(sidebarLink(page, "/dashboard")).toBeVisible();
    await expect(sidebarLink(page, "/instructor")).toBeVisible();
    await expect(sidebarLink(page, "/help")).toBeVisible();

    const hrefs = await sidebarHrefs(page);
    // The admin console is ADMIN-only in both places now: `getNavForUser()`
    // gates the entry on `canAccessAdminConsole()`, and `routes/admin.tsx`
    // admits only ADMIN. There is nothing here to navigate to, and typing the
    // URL gets a 404 (unit-admin-admin-console.spec.ts).
    expect(hrefs).not.toContain("/admin");
    // Student-side navigation must not appear for a staff role either.
    expect(hrefs).not.toContain("/student");
  });

  test("Courses in the sidebar opens the instructor course shell", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    await sidebarLink(page, "/instructor").click();
    await page.waitForURL(`${AI_TUTOR_URL}/instructor`);
    await expect(page.getByText("Browse your courses and manage their content.")).toBeVisible();
  });

  test("the command palette offers navigation and a unit-scoped course switcher", async ({
    page,
  }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);
    // Wait for hydration: the shortcut is bound by the palette component, so
    // pressing it before the SPA has mounted silently does nothing. The click
    // moves focus into the document so the keydown reaches that listener.
    await expect(page.getByText("Your unit's courses and administration.")).toBeVisible();
    await page.locator("body").click({ position: { x: 5, y: 5 } });

    const palette = commandPalette(page);
    await expect(async () => {
      await page.keyboard.press("Control+k");
      await expect(palette).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 20_000 });

    for (const item of ["Dashboard", "Courses", "Settings", "Help"]) {
      await expect(palette.getByRole("option", { name: item, exact: true })).toBeVisible();
    }

    // "Switch course" is fed by the same unit-scoped /api/courses list as the
    // course pages, so the in-unit course is offered here.
    await palette.getByRole("combobox").fill(ua.course.name);
    await expect(palette.getByRole("option").first()).toContainText(ua.course.name);

    // …and selecting it actually switches course, rather than merely listing it.
    await palette.getByRole("option").first().click();
    await page.waitForURL(`${AI_TUTOR_URL}/instructor/courses/${ua.course.atCourseId}`);
    await expect(page.getByRole("heading", { name: ua.course.name, level: 1 })).toBeVisible();
  });

  test("the sidebar user menu is a second route into Settings", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    // The palette is one way in (covered above); the sidebar footer user menu is
    // the other, and it is the only one a mouse-only user is likely to find.
    await userMenuButton(page).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();

    await page.waitForURL(`${AI_TUTOR_URL}/settings`);
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("the guided tour is offered on both screens the unit admin works from", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    // `canAccessUnitAdminTour` admits UNIT_ADMIN on /dashboard and the
    // instructor shell — the two routes `unit-admin-orientation` actually
    // visits. The learner-voiced student tours stay out of scope for this role.
    await expect(page.getByRole("button", { name: "Take Tour" })).toBeVisible();

    await page.goto(`${AI_TUTOR_URL}/instructor`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Browse your courses and manage their content.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Take Tour" })).toBeVisible();

    // …and not on routes the tour never navigates to, where starting it would
    // immediately yank the reader off the page they are on.
    await page.goto(`${AI_TUTOR_URL}/settings`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Take Tour|Stop Tour/ })).toHaveCount(0);
  });

  test("the guided tour runs, and its copy is written for a unit admin", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);
    await expect(page.getByText("Your unit's courses and administration.")).toBeVisible();

    // Driven, not merely offered: the point of this row is that the tour a unit
    // admin gets is the staff one, not a learner tour retitled.
    await page.getByRole("button", { name: "Take Tour" }).click();

    const popover = page.locator(".driver-popover");
    await expect(popover).toBeVisible({ timeout: 15_000 });
    await expect(popover).toContainText("A quick tour of your unit");
    await expect(page.getByRole("button", { name: "Stop Tour" })).toBeVisible();

    // Step 2 lands on the unit rollup — proof the tour advances through its own
    // anchors rather than sitting on the button that started it.
    await popover.getByRole("button", { name: "Continue" }).click();
    await expect(popover).toContainText("Your unit at a glance");

    // Closed from the popover, not from the sidebar's "Stop Tour" button: while
    // a tour is running driver.js lays a full-viewport overlay `<svg>` over the
    // page, and it intercepts pointer events — so a click on the sidebar button
    // underneath never lands and Playwright retries until the test times out.
    // The popover's own close control sits above that overlay and is wired to
    // the same `stopTour()` (`TourProvider.tsx`), so this exercises the same
    // exit path a reader actually has while a step is open.
    await popover.getByRole("button", { name: "Close tour" }).click();
    await expect(popover).toHaveCount(0);
  });

  test("the header reports AI service availability", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    // Shell chrome every role sees: two independent chips whose accessible name
    // carries the state (`${label}: ${state}`). It is the only in-app signal
    // that the model backends are reachable, so a unit admin diagnosing "the
    // tutor is broken" starts here.
    await expect(page.getByRole("button", { name: /^UBC-hosted AI: / })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Cloud AI: / })).toBeVisible();
  });

  test("the root path routes a unit admin to their dashboard", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    // `routes/home.tsx` resolves the landing route from the session role via
    // `routeForRole`. It is also where a sign-out lands, so it must not strand
    // a signed-in staff user on the loading shell.
    await page.goto(`${AI_TUTOR_URL}/`, { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(`${AI_TUTOR_URL}/dashboard`, { timeout: 15_000 });
    await expect(page.getByText("Your unit's courses and administration.")).toBeVisible();
  });

  test("the command palette navigates to the page it is asked for", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);
    await expect(page.getByText("Your unit's courses and administration.")).toBeVisible();

    // The header button is the mouse-driven route into the same palette.
    await page.getByRole("button", { name: "Open command palette" }).click();
    await commandPalette(page).getByRole("option", { name: "Settings", exact: true }).click();
    await page.waitForURL(`${AI_TUTOR_URL}/settings`);
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("the app launcher offers the other EduAI apps and marks AI Tutor as current", async ({
    page,
  }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    await page.getByRole("button", { name: /Switch app/i }).click();
    const launcher = page
      .locator("[role=menu], [role=dialog]")
      .filter({ hasText: "EduAI Core" })
      .first();
    await expect(launcher).toBeVisible();
    await expect(launcher.getByText("Question Maker")).toBeVisible();
    await expect(launcher.getByText("NOW")).toBeVisible();
  });

  test("Help renders the unit-administrator guide", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/help`);

    await expect(page.getByRole("heading", { name: "Help & guide" })).toBeVisible();
    // HelpView labels the guide with the caller's own role.
    await expect(page.getByText("Unit administrator", { exact: true })).toBeVisible();
    // STAFF section — unit admins share the instructor/TA guidance.
    await expect(
      page.locator("#teaching").getByText("For instructors, TAs, and unit admins"),
    ).toBeVisible();
  });

  test("the theme toggle switches the app between light and dark", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    const toggle = page.getByRole("button", { name: /Switch to (dark|light) mode/ });
    const before = await toggle.getAttribute("aria-label");
    await toggle.click();
    await expect(toggle).not.toHaveAttribute("aria-label", before!);
  });

  test("signing out from Settings ends the session and locks the app", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/settings`);

    await page.getByRole("button", { name: "Log out" }).click();

    // Sign-out proxies to Core, so the dashboard can no longer render its
    // unit-admin hero once the session is gone.
    await expect(async () => {
      await page.goto(`${AI_TUTOR_URL}/dashboard`, { waitUntil: "domcontentloaded" });
      await expect(page.getByText("Your unit's courses and administration.")).toHaveCount(0);
    }).toPass({ timeout: 20_000 });
  });
});
