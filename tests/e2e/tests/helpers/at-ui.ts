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
