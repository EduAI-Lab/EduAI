/**
 * AI Tutor — STUDENT access and app-shell workflows, driven through the browser.
 *
 * Covers the paths a student reaches before opening any course: signing in
 * through Core, the shared dashboard landing, the RBAC-filtered sidebar and
 * command palette, the app launcher, theme, the bug-report dialog, Help, the
 * guided tour, sign-out, and the staff routes a student is deliberately kept
 * out of.
 *
 * Companion specs: student-dashboard, student-course-list,
 * student-course-navigation, student-lesson-player, student-ai-chat,
 * student-settings, student-security. Path inventory and findings live in
 * `docs/end-to-end-user-workflows/ai-tutor-workflows.md` (Student section).
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_API_URL, AI_TUTOR_URL, CORE_URL } from "../../playwright.config";
import { DEFAULT_PASSWORD, registerUser, signOut } from "../helpers/auth";
import {
  gotoAiTutor,
  loginAsStudent,
  openAppSwitcher,
  openBugReport,
  openHelpTourEntry,
  openRailTray,
  sidebar,
} from "../helpers/at-ui";

test.describe("AI Tutor STUDENT — sign-in and landing", () => {
  test("signs in through Core's form and lands on the shared dashboard as STUDENT", async ({
    page,
  }) => {
    // AI Tutor has no login of its own — it consumes a Core session cookie. A
    // fresh registration is already a STUDENT, so no promotion is needed; just
    // drop the auto-sign-in session so Core actually shows the form.
    const user = await registerUser(page.request, { prefix: "at-student-login" });
    await signOut(page.request);

    await page.goto(
      `${CORE_URL}/login?redirect=${encodeURIComponent(`${AI_TUTOR_URL}/dashboard`)}`,
    );
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/password/i).fill(DEFAULT_PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await page.waitForURL(/localhost:3001/, { timeout: 30_000 });
    // The signed-in user is shown in the rail's Account tray.
    await expect(sidebar(page).getByRole("button", { name: "Account", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect((await openRailTray(page, "Account")).getByText(user.email)).toBeVisible();
  });

  test("root path routes a student to the shared dashboard", async ({ page }) => {
    await registerUser(page.request, { prefix: "at-student-root" });
    await page.goto(`${AI_TUTOR_URL}/`);
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  });
});

test.describe("AI Tutor STUDENT — sidebar navigation", () => {
  test("sidebar offers exactly Dashboard, Courses, and Help — no staff entries", async ({
    page,
  }) => {
    await loginAsStudent(page, "at-student-nav");

    const nav = sidebar(page);
    for (const label of ["Dashboard", "Courses", "Help"]) {
      // Courses and Help open trays, so they are buttons; the rest are links.
      await expect(
        nav
          .getByRole(label === "Courses" || label === "Help" ? "button" : "link", {
            name: label,
            exact: true,
          })
          .first(),
      ).toBeVisible();
    }
    // A student is never offered the admin console or an instructor surface.
    await expect(nav.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
  });

  test("Courses in the sidebar opens the student's own enrolled-course list", async ({ page }) => {
    await loginAsStudent(page, "at-student-nav-courses");
    await (await openRailTray(page, "Courses")).getByRole("link", { name: "All courses" }).click();
    await expect(page).toHaveURL(/\/student$/);
    // The student list is scoped to enrolments — its own heading, not the
    // instructor's "Browse your courses and manage their content."
    await expect(
      page.getByText("Continue where you left off or explore your courses."),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("the user menu exposes Settings and Log out", async ({ page }) => {
    const student = await loginAsStudent(page, "at-student-usermenu");
    const menu = await openRailTray(page, "Account");
    await expect(menu.getByText("Settings")).toBeVisible();
    await expect(menu.getByText(/log out/i)).toBeVisible();
  });
});

test.describe("AI Tutor STUDENT — command palette", () => {
  test("opens with Ctrl+K and lists only the student's navigation targets", async ({ page }) => {
    await loginAsStudent(page, "at-student-palette");
    await page.keyboard.press("Control+k");

    const palette = page.locator('[role="dialog"]');
    await expect(palette).toBeVisible();
    for (const label of ["Dashboard", "Courses", "Settings", "Help"]) {
      await expect(palette.getByText(label, { exact: true }).first()).toBeVisible();
    }
    // The palette reuses `getNavForUser`, so it can never surface a staff route.
    await expect(palette.getByText("Admin", { exact: true })).toHaveCount(0);
  });

  test("typing narrows the palette and Enter navigates to the course list", async ({ page }) => {
    await loginAsStudent(page, "at-student-palette-nav");
    await page.keyboard.press("Control+k");
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    await page.keyboard.type("Courses");
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/student$/, { timeout: 15_000 });
  });
});

test.describe("AI Tutor STUDENT — suite switcher and chrome", () => {
  test("the app launcher lists the suite and marks AI Tutor as current", async ({ page }) => {
    await loginAsStudent(page, "at-student-launcher");
    const menu = await openAppSwitcher(page);
    await expect(menu.getByRole("link", { name: /EduAI Core/ })).toHaveAttribute(
      "href",
      /localhost:3000/,
    );
    // The current app is listed but is not a link.
    await expect(menu.locator('[aria-current="page"]', { hasText: "AI Tutor" })).toBeVisible();
  });

  test("the theme toggle flips the shell between light and dark", async ({ page }) => {
    await loginAsStudent(page, "at-student-theme");
    const toggle = page.getByRole("button", { name: /switch to (dark|light) mode/i });
    const before = await toggle.getAttribute("aria-label");
    await toggle.click();
    await expect(toggle).not.toHaveAttribute("aria-label", before ?? "");
  });

  test("the bug-report dialog is available from every shell page", async ({ page }) => {
    await loginAsStudent(page, "at-student-bugbutton");
    await openBugReport(page);
    const dialog = page.getByRole("dialog", { name: "Report a bug" });
    await expect(dialog.getByText("Report a bug")).toBeVisible();
    await expect(dialog.getByTestId("bug-type")).toBeVisible();
    await expect(dialog.getByTestId("bug-description")).toBeVisible();
  });

  test("a student can submit a bug report from the shell", async ({ page }) => {
    await loginAsStudent(page, "at-student-bugsubmit");
    await openBugReport(page);
    const dialog = page.getByRole("dialog", { name: "Report a bug" });
    await dialog.getByTestId("bug-type").click();
    await page.locator('[role="option"]').first().click();
    await dialog.getByTestId("bug-description").fill(`E2E student bug probe ${Date.now()}`);
    await dialog.getByRole("button", { name: /submit report/i }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
  });
});

test.describe("AI Tutor STUDENT — Help and guided tour", () => {
  test("Help shows the student 'Using the AI tutor' guidance", async ({ page }) => {
    await loginAsStudent(page, "at-student-help");
    await (await openRailTray(page, "Help")).getByRole("link", { name: "Help & guide" }).click();

    await expect(page).toHaveURL(/\/help$/);
    await expect(page.getByRole("heading", { name: /Help & guide/i })).toBeVisible();
    await expect(page.getByText(/Using the AI tutor/i).first()).toBeVisible();
  });

  test("the guided tour IS offered to a student", async ({ page }) => {
    // `canAccessStudentTour` is STUDENT/TA only — the inverse of the admin case,
    // where the help modal has no tour entry. Here it must.
    await loginAsStudent(page, "at-student-tour");
    await gotoAiTutor(page, "/student");
    await expect(await openHelpTourEntry(page)).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("AI Tutor STUDENT — routes a student is kept out of", () => {
  for (const path of ["/admin", "/instructor", "/instructor/courses/1"]) {
    test(`${path} answers a STUDENT with a 404 rather than a silent bounce`, async ({ page }) => {
      await registerUser(page.request, { prefix: "at-student-blocked" });
      await page.goto(`${AI_TUTOR_URL}${path}`);

      await expect(page.getByText("404 — Page not found")).toBeVisible({ timeout: 30_000 });
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      // Still inside the shell, with a way onwards.
      await expect(
        page.getByRole("link", { name: "Dashboard", exact: true }).first(),
      ).toBeVisible();
    });
  }

  test("a URL that matches no route is a 404 inside the shell", async ({ page }) => {
    await registerUser(page.request, { prefix: "at-student-nosuchroute" });
    await page.goto(`${AI_TUTOR_URL}/no-such-page`);

    await expect(page.getByText("404 — Page not found")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/An unexpected error occurred/i)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Dashboard", exact: true }).first()).toBeVisible();
  });
});

test.describe("AI Tutor STUDENT — sign-out", () => {
  test("Settings → Log out returns to Core's login and protected routes bounce", async ({
    page,
  }) => {
    await loginAsStudent(page, "at-student-logout");

    await gotoAiTutor(page, "/settings");
    await page.getByRole("button", { name: /^log out$/i }).click();

    await expect(page).toHaveURL(/localhost:3000\/auth\/login/, { timeout: 30_000 });

    await page.goto(`${AI_TUTOR_URL}/dashboard`);
    await expect(page).toHaveURL(/localhost:3000\/auth\/login.*redirect=.*dashboard/, {
      timeout: 30_000,
    });
    await expect(page).toHaveURL(/force=1/);

    const me = await page.request.get(`${AI_TUTOR_API_URL}/api/me`);
    expect(me.status()).toBe(401);
  });
});
