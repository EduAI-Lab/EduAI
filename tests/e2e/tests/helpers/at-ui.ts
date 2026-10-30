/**
 * Browser-driving helpers for the AI Tutor SPA (port 3001).
 *
 * The rest of `tests/helpers/` talks to the APIs directly. These helpers exist
 * for the workflow specs that must click through the real UI the way a user
 * does (see `docs/end-to-end-user-workflows/README.md`, methodology step 2).
 *
 * Session model: AI Tutor has no login page of its own — it reads a Core
 * session cookie and its Express server revalidates it against Core on every
 * request. `page.request` shares the browser context's cookie jar, so signing
 * in through it (via the shared `helpers/auth` functions) authenticates the
 * page too, without re-implementing Core's sign-in form per spec.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { AI_TUTOR_URL } from "../../playwright.config";
import { createAdmin, promoteUser, registerUser, signIn, signOut } from "./auth";

export { AI_TUTOR_URL };

/** Sign in as a fresh ADMIN and land on AI Tutor's dashboard. */
export async function loginAsAdmin(
  page: Page,
  prefix = "at-ui-admin",
): Promise<{ email: string; password: string; name: string }> {
  const admin = await createAdmin(page.request, { prefix, name: "E2E AT Admin" });
  await gotoAiTutor(page, "/dashboard");
  return admin;
}

/**
 * Sign in as a fresh STUDENT and land on AI Tutor's dashboard.
 *
 * STUDENT is the default role of a self-registration, so no promotion or
 * re-authentication is needed — the sign-up session already carries it.
 */
export async function loginAsStudent(
  page: Page,
  prefix = "at-ui-student",
): Promise<{ email: string; password: string; name: string }> {
  const student = await registerUser(page.request, { prefix, name: "E2E AT Student" });
  await gotoAiTutor(page, "/dashboard");
  return student;
}

/**
 * Sign in as a fresh user with a platform role (no navigation).
 *
 * TA is deliberately absent: Core dropped `UserRole.TA` (a course TA is a
 * STUDENT-platform user with an `EnrollmentRole.TA` enrollment), so
 * `/api/e2e/promote` rejects it with 400.
 */
export async function signInAs(
  page: Page,
  role: "STUDENT" | "INSTRUCTOR" | "UNIT_ADMIN" | "ADMIN",
  prefix: string,
): Promise<{ email: string; password: string; name: string }> {
  const user = await registerUser(page.request, { prefix, name: `E2E ${role}` });
  if (role !== "STUDENT") {
    await promoteUser(page.request, user.email, role);
    await signOut(page.request);
    await signIn(page.request, { email: user.email, password: user.password });
  }
  return user;
}

/**
 * The global nav rail (`@eduai/ui`'s `GlobalNavRail`): the app switcher, then
 * the Account, Courses and Help tray buttons and the plain nav links. The mobile
 * drawer reuses the "Global" name, but it is only mounted while open, so at the
 * suite's desktop viewport the first match is always the rail.
 */
export function sidebar(page: Page) {
  return page.getByRole("navigation", { name: "Global" }).first();
}

export type RailTray = "Account" | "Courses" | "Administration" | "Help";

/**
 * Open one of the rail's flyout trays and return it. Account holds Settings,
 * Back to EduAI, the theme switch and Log out; Courses lists the
 * user's courses plus "All courses"; Help holds the guide and Report a bug.
 */
export async function openRailTray(page: Page, tray: RailTray): Promise<Locator> {
  await sidebar(page).getByRole("button", { name: tray, exact: true }).click();
  const panel = page.getByRole("dialog", { name: tray });
  await expect(panel).toBeVisible();
  return panel;
}

/**
 * Open the app switcher from the rail's top tile (the current app's icon) and
 * return its tray: one row per app, the current one marked and not a link.
 */
export async function openAppSwitcher(page: Page): Promise<Locator> {
  await sidebar(page)
    .getByRole("button", { name: /^Switch app/ })
    .click();
  const panel = page.getByRole("dialog", { name: "Switch app" });
  await expect(panel).toBeVisible();
  return panel;
}

/**
 * A section link in the shell's course menu (Content, Submissions, Feedback,
 * Analytics on a staff course page) — they replaced the page's tab bar.
 */
export function courseMenuLink(page: Page, name: string) {
  return page.getByRole("navigation", { name: "Course" }).getByRole("link", { name, exact: true });
}

/** Open the bug-report dialog from the Help tray (it left the header). */
export async function openBugReport(page: Page): Promise<void> {
  const help = await openRailTray(page, "Help");
  await help.getByRole("button", { name: "Report a bug" }).click();
}

/**
 * Navigate to an AI Tutor path and wait for the SPA to finish its auth
 * bootstrap. Every authenticated route runs `requireClientUser()` in a
 * clientLoader, so "the shell is painted" is the first moment a test can
 * safely assert on page content.
 */
export async function gotoAiTutor(page: Page, path: string): Promise<void> {
  await page.goto(`${AI_TUTOR_URL}${path}`);
  await expect(sidebar(page).getByRole("link", { name: "Dashboard", exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Open the header (?) help modal and return its "Take the tour" entry — the
 * one place every app launches its guided tour from (#1754). A locator, so
 * `toHaveCount(0)` asserts that no tour is offered here.
 */
export async function openHelpTourEntry(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Help for this page" }).click();
  const dialog = page.getByTestId("page-help-dialog");
  await expect(dialog).toBeVisible();
  return dialog.getByRole("button", { name: "Take the tour" });
}

/**
 * A rail *nav* link addressed by its `href` rather than its label. Returns a
 * locator, so `toHaveCount(0)` is a valid assertion that the entry is absent.
 *
 * Scoped to the rail's entry list rather than the whole rail, so links inside
 * an open tray never match. Courses and Help are tray buttons, not links; reach
 * their destinations through `openRailTray`.
 */
export function sidebarLink(page: Page, href: string) {
  return sidebar(page).locator(`ul a[href="${href}"]`);
}

/** The shell's content area, for reading what a page actually rendered. */
export function shellMain(page: Page) {
  return page.getByRole("main");
}

/**
 * Every `href` in the rail, in render order: just the plain nav links (the app
 * switcher and tray entries are buttons and carry none).
 *
 * For "this destination has no navigation affordance at all" assertions, where
 * asking for one link by name would pass simply because the name changed.
 */
export async function sidebarHrefs(page: Page): Promise<string[]> {
  const links = sidebar(page).getByRole("link");
  await expect(links.first()).toBeVisible();
  return links.evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute("href") ?? "").filter(Boolean),
  );
}

/** The rail's Account entry, which opens the Account tray (`openRailTray(page, "Account")`). */
export function userMenuButton(page: Page) {
  return sidebar(page).getByRole("button", { name: "Account", exact: true });
}

/**
 * The command palette (Ctrl/⌘-K), as a cmdk root rather than a dialog.
 *
 * The shell mounts the bug-report dialog alongside it, so `getByRole("dialog")`
 * is ambiguous the moment either is open. `[cmdk-root]` is unique to the
 * palette and still scopes `getByRole("combobox")` (its input) and
 * `getByRole("option")` (its items).
 */
export function commandPalette(page: Page) {
  return page.locator("[cmdk-root]").first();
}

/**
 * The card-level link for a course in a course list.
 *
 * `CourseCard`'s clickable element is a transparent overlay `<a>` carrying only
 * an `aria-label`, so it has no visible text to match on — the href is what
 * identifies it.
 */
export function courseLink(page: Page, courseId: number) {
  return page.locator(`a[href$="/courses/${courseId}"]`).first();
}

/**
 * The in-shell error state a route boundary renders (`RouteErrorState`).
 *
 * On this branch a 403/404/400 from a loader resolves to `NotFoundState`, which
 * renders *inside* `_app.tsx` — the sidebar and header stay mounted. Match its
 * heading rather than the surrounding chrome, and note that the generic copy is
 * the point: a record the caller may not see must look identical to one that
 * does not exist.
 */
export function errorBoundary(page: Page) {
  return page.getByText("404 — Page not found");
}

/** The rail's nav link labels, in render order (tray entries are buttons, not links). */
export async function sidebarLinkNames(page: Page): Promise<string[]> {
  const links = sidebar(page).getByRole("link");
  await expect(links.first()).toBeVisible();
  const names = await links.allInnerTexts();
  return names.map((n) => n.trim()).filter(Boolean);
}

/** Click a rail nav link by its visible label. */
export async function clickSidebar(page: Page, label: string): Promise<void> {
  await sidebar(page).getByRole("link", { name: label, exact: true }).first().click();
}

/**
 * Open a section by its visible label and wait for it to take effect. A course
 * page's sections live in the shell's course menu (links that set `?tab=`);
 * other pages (admin, settings) keep a `PageTabs` tablist. Right after a reload
 * either can be painted before it is interactive, so a bare click is retried.
 */
export async function openTab(page: Page, label: string | RegExp): Promise<void> {
  // Wait for the shell first. `_app.tsx` renders a bare `<Outlet />` while
  // `useLocalUser()` is still resolving `/api/me`, then swaps in the shell
  // once the user lands — a different tree position, so the route remounts.
  // The rail only exists in the post-swap tree, so this is the point after
  // which no auth-driven remount can undo the click.
  await expect(sidebar(page).getByRole("link", { name: "Dashboard", exact: true })).toBeVisible({
    timeout: 30_000,
  });

  const courseMenu = page.getByRole("navigation", { name: "Course" });
  if (await courseMenu.count()) {
    const link = courseMenu.getByRole("link", { name: label });
    await expect(async () => {
      if ((await link.getAttribute("aria-current")) !== "page") await link.click();
      await expect(link).toHaveAttribute("aria-current", "page", { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    return;
  }

  const tab = page.getByRole("tab", { name: label });
  await expect(tab).toBeVisible({ timeout: 30_000 });

  // Retry rather than click once: a click that lands before the tablist is
  // hydrated is swallowed silently, which then shows up as a confusing
  // assertion failure against whatever the default tab renders.
  await expect(async () => {
    if ((await tab.getAttribute("aria-selected")) !== "true") {
      await tab.click();
    }
    await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}
