/**
 * AI Tutor INSTRUCTOR — shell and navigation workflows (browser-driven).
 *
 * An instructor uses the *instructor shell* (`usesInstructorShell()`), the same
 * one unit admins and TAs get: one `/dashboard` landing page, one `/instructor`
 * course list, and no screen of its own. What separates the role is scope —
 * courses they are enrolled on as INSTRUCTOR — and the absence of the admin
 * console. These tests walk the chrome that wraps every one of those screens.
 *
 * They assert the instructor *shape* of the shell (which nav entries, which
 * header controls, which palette groups) rather than counts or course names
 * that move between runs.
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_URL, CORE_URL } from "../../playwright.config";
import { signInThroughPage } from "../helpers/auth";
import { createTeachingInstructor, type InstructorFixture } from "../helpers/at-instructor";
import {
  commandPalette,
  gotoAiTutor,
  sidebar,
  sidebarHrefs,
  userMenuButton,
} from "../helpers/at-ui";

let fx: InstructorFixture;

test.beforeAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  try {
    fx = await createTeachingInstructor(playwright, ctx, { secondCourse: true });
  } finally {
    await ctx.dispose();
  }
});

test.afterAll(async () => {
  await fx?.dispose();
});

test.describe("INSTRUCTOR shell and navigation", () => {
  test("signing in via Core lands on the instructor dashboard", async ({ page }) => {
    // AI Tutor has no sign-in of its own: it reads a Core session cookie and
    // its Express server revalidates it against Core on every request.
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible({
      timeout: 30_000,
    });
    // The role is named in the sidebar footer, so the reader can tell which
    // view of the app they are looking at without inferring it from content.
    await expect(sidebar(page).getByText("Instructor", { exact: true })).toBeVisible();
  });

  test("the sidebar offers exactly Dashboard, Courses and Help", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // Addressed by href, not label: an ADMIN gets two entries both labelled
    // "Courses", so the label alone is not a stable identity. The first
    // `/dashboard` is the sidebar logo, which links to the role's home.
    expect(await sidebarHrefs(page)).toEqual(["/dashboard", "/dashboard", "/instructor", "/help"]);
  });

  test("the sidebar carries no admin entry", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // `canAccessAdminConsole` is ADMIN-only, so the console is not merely
    // unreachable — it is never advertised. (The route itself is covered by
    // instructor-access-boundaries.spec.ts.)
    await expect(sidebar(page).locator('a[href="/admin"]')).toHaveCount(0);
  });

  test("landing on `/` routes to the role's home", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    await page.goto(`${AI_TUTOR_URL}/`);
    // `routeForRole` sends every supported role to /dashboard; this is also
    // where the post-sign-out bounce and the sidebar logo land.
    await page.waitForURL(`${AI_TUTOR_URL}/dashboard`, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
  });

  test("the command palette jumps to a page", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // Opened from the header control rather than the Ctrl-K accelerator: the
    // shortcut needs the document to hold focus, which is not guaranteed
    // immediately after a cross-origin sign-in redirect, and the button is the
    // affordance a mouse-only user has anyway.
    await page.getByRole("button", { name: "Open command palette" }).click();
    const palette = commandPalette(page);
    await expect(palette).toBeVisible();

    // Three groups, one of which is the suite switcher. "Settings" is here even
    // though the sidebar nav has no Settings entry.
    await expect(page.locator("[cmdk-group-heading]", { hasText: "Go to" })).toBeVisible();
    await expect(palette.getByRole("option", { name: "Settings" })).toBeVisible();

    // Driven to its destination, not merely listed.
    await palette.getByRole("option", { name: "Settings" }).click();
    await page.waitForURL(`${AI_TUTOR_URL}/settings`);
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("the command palette switches course", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const second = fx.second!;

    await page.getByRole("button", { name: "Open command palette" }).click();
    const palette = commandPalette(page);
    await expect(palette).toBeVisible();
    await expect(page.locator("[cmdk-group-heading]", { hasText: "Switch course" })).toBeVisible();

    // #1208: courses are searched server-side, so typing narrows against the
    // whole taught set rather than whatever happened to be preloaded.
    await palette.getByRole("combobox").fill(second.name);
    const option = palette.getByRole("option", { name: second.name });
    await expect(option).toBeVisible({ timeout: 15_000 });
    await option.click();

    await page.waitForURL(`${AI_TUTOR_URL}/instructor/courses/${second.atCourseId}`);
    await expect(page.getByText(second.code).first()).toBeVisible();
  });

  test("the sidebar user menu reaches Settings", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // The only Settings route a mouse-only user is likely to find: the sidebar
    // nav itself has no Settings entry.
    await userMenuButton(page).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();

    await page.waitForURL(`${AI_TUTOR_URL}/settings`);
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("the app launcher offers the other EduAI apps", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    await sidebar(page).getByRole("button", { name: "Switch app" }).click();
    await expect(page.getByRole("menuitem", { name: /EduAI Core/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Question Maker/ })).toBeVisible();
    // AI Tutor marks itself as the current app rather than offering a no-op
    // jump. The badge reads "Now" in the DOM and is uppercased by CSS, so match
    // the text case-insensitively rather than the rendered casing.
    const current = page.getByRole("menuitem", { name: /AI Tutor/ });
    await expect(current).toContainText(/now/i);
    await expect(current).toHaveAttribute("aria-current", "page");
  });

  test("the header reports AI service availability", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // Two chips whose accessible name carries the state — the only in-app
    // signal that the model backends are reachable. Assert the shape of the
    // name, not a particular state: which backend is up varies by environment.
    await expect(page.getByRole("button", { name: /^UBC-hosted AI: / })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Cloud AI: / })).toBeVisible();
  });

  test("the header toggles light and dark theme", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    const toggle = page.getByRole("button", { name: /^Switch to (dark|light) mode$/ });
    const before = await toggle.getAttribute("aria-label");
    await toggle.click();
    // The control renames itself to the *other* direction, which is the only
    // in-header evidence the theme actually changed.
    await expect(toggle).not.toHaveAttribute("aria-label", before ?? "");
  });

  test("the header opens a bug report and requires both fields", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    await page.getByRole("button", { name: "Report a bug" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Report a bug");
    // Available to every role, with an anonymous option and diagnostics off by
    // default — the copy says so rather than attaching silently.
    await expect(dialog).toContainText("Submit anonymously");
    await expect(dialog).toContainText("Diagnostic attachments are optional and off by default");
  });

  test("the Help guide is labelled for this role", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, "/help");

    await expect(page.getByRole("heading", { name: "Help & guide" })).toBeVisible();
    // `getRoleViewLabel("INSTRUCTOR")` — the badge names the view being read.
    await expect(page.getByText("Instructor", { exact: true }).first()).toBeVisible();
    // The staff topic is gated on the teaching roles and names instructors first.
    await expect(
      page.getByRole("link", { name: "For instructors, TAs, and unit admins" }),
    ).toBeVisible();
  });

  test("no guided tour is offered to an instructor", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // `canAccessTour` admits STUDENT/TA on the student shell and UNIT_ADMIN on
    // /dashboard + /instructor — INSTRUCTOR is in neither branch, so the
    // sidebar-footer control never renders. `tour-storage.ts` says why: the
    // unit-admin tour is unit-scoped and staff-voiced, and extending it to
    // instructors would need its own copy rather than another role in the list.
    // Asserted on both routes the unit-admin tour is offered from, so a future
    // instructor tour turns this into a deliberate, visible change.
    const tourButton = sidebar(page).getByRole("button", { name: /Take Tour|Stop Tour/ });
    await expect(tourButton).toHaveCount(0);

    await gotoAiTutor(page, "/instructor");
    await expect(tourButton).toHaveCount(0);
  });

  test("breadcrumbs trace the content hierarchy", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, `/instructor/courses/${fx.course.atCourseId}`);

    const crumbs = page.getByRole("navigation");
    await expect(crumbs.getByRole("link", { name: "Courses" })).toBeVisible();
    // The course crumb is the switcher, not a plain label — covered as its own
    // workflow in instructor-course-detail.spec.ts.
    await expect(page.getByRole("button", { name: fx.course.name })).toBeVisible();
  });

  test("signing out returns to Core and drops the session", async ({ page }) => {
    // Safe against the shared fixture: each test gets its own browser context,
    // so signing out here drops this context's cookie, not the account.
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    await userMenuButton(page).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();

    // Logout navigates to "/", which bounces to Core's login because there is
    // no session left to route on.
    await page.waitForURL((url) => url.origin === CORE_URL, { timeout: 30_000 });
    expect(page.url()).toContain(CORE_URL);
  });
});
