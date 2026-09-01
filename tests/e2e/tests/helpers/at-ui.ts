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
import { expect, type Page } from "@playwright/test";
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
 * The app-shell sidebar. It is a `data-slot="sidebar"` region rather than a
 * `<nav>` landmark (`@eduai/ui`'s `sidebar.tsx`), so `getByRole("navigation")`
 * finds the header breadcrumbs instead — scope sidebar assertions through this.
 */
export function sidebar(page: Page) {
  return page.locator('[data-slot="sidebar"]').first();
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
 * A sidebar *nav* link addressed by its `href` rather than its label.
 *
 * Two entries can share a label — ADMIN gets "Courses" from both the teaching
 * and admin-courses nav keys — so the href is the only stable identity. Returns
 * a locator, so `toHaveCount(0)` is a valid assertion that the entry is absent.
 *
 * Scoped to `sidebar-content` (NavMain + NavSecondary) rather than the whole
 * sidebar, because `SidebarHeader` carries the brand logo as a link too and
 * `_app.tsx` points it at `logoHref: routeForRole(user.role)`. For every role
 * whose home is `/dashboard` that collides with the Dashboard nav entry, and an
 * unscoped `a[href="/dashboard"]` matches both — a strict-mode violation rather
 * than a missing element, so it fails as "resolved to 2 elements".
 */
export function sidebarLink(page: Page, href: string) {
  return sidebar(page).locator(`[data-slot="sidebar-content"] a[href="${href}"]`);
}

/**
 * The shell's content area, for reading what a page actually rendered.
 *
 * `getByRole("main")` is ambiguous here: `@eduai/ui`'s `SidebarInset`
 * (`ui/sidebar.tsx`) renders `<main data-slot="sidebar-inset">` and `AppShell`
 * renders a second `<main>` inside it. Two nested `main` landmarks is an
 * accessibility defect in the shared shell — reported separately; this helper
 * only keeps the tests deterministic by naming the inner one explicitly.
 */
export function shellMain(page: Page) {
  return page.locator('[data-slot="sidebar-inset"] main');
}

/**
 * Every `href` in the sidebar, in render order.
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

/**
 * The sidebar footer's user-menu trigger — name, role badge, and the menu
 * holding Settings and Log out.
 *
 * The footer holds up to three controls (Take Tour, the app launcher, this),
 * and the launcher is a menu trigger too. NavUser renders last, so the final
 * menu trigger in the footer is this one.
 */
export function userMenuButton(page: Page) {
  return sidebar(page).locator('[data-slot="sidebar-footer"] button[aria-haspopup="menu"]').last();
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

/** The sidebar's nav link labels, in render order. */
export async function sidebarLinkNames(page: Page): Promise<string[]> {
  const links = sidebar(page).getByRole("link");
  await expect(links.first()).toBeVisible();
  const names = await links.allInnerTexts();
  return names.map((n) => n.trim()).filter(Boolean);
}

/** Click a sidebar nav link by its visible label. */
export async function clickSidebar(page: Page, label: string): Promise<void> {
  await sidebar(page).getByRole("link", { name: label, exact: true }).first().click();
}

/**
 * Open a tab in a `PageTabs` tablist by its visible label and wait for it to
 * actually become the selected tab — right after a reload the tablist can be
 * painted before it is interactive, so a bare click is silently dropped.
 */
export async function openTab(page: Page, label: string | RegExp): Promise<void> {
  // Wait for the shell before touching the tablist. `_app.tsx` renders a bare
  // `<Outlet />` while `useLocalUser()` is still resolving `/api/me`, then
  // swaps in `<AppShell><Outlet /></AppShell>` once the user lands — a
  // different tree position, so the route remounts and its `activeTab` state
  // resets to the default. A tab clicked before that swap goes selected and is
  // then silently reverted, which reads as "the panel never rendered". The
  // sidebar only exists in the post-swap tree, so this is the point after
  // which no auth-driven remount can undo the click.
  await expect(sidebar(page).getByRole("link", { name: "Dashboard", exact: true })).toBeVisible({
    timeout: 30_000,
  });

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
