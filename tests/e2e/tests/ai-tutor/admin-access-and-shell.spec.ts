/**
 * AI Tutor — ADMIN access and app-shell workflows, driven through the browser.
 *
 * Covers the paths an admin reaches before touching any course: landing on the
 * shared dashboard, the RBAC-filtered sidebar, the command palette, the app
 * launcher, Help, sign-out, and the routes an admin is deliberately kept out
 * of (the student shell).
 *
 * Companion specs: admin-dashboard, admin-console, admin-course-oversight,
 * admin-content-authoring. Path inventory and findings live in
 * `docs/end-to-end-user-workflows/ai-tutor-workflows.md` (Admin section).
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_API_URL, AI_TUTOR_URL, CORE_URL } from "../../playwright.config";
import { createAdmin, DEFAULT_PASSWORD, promoteUser, registerUser, signOut } from "../helpers/auth";
import { gotoAiTutor, loginAsAdmin, openTab, sidebar } from "../helpers/at-ui";
import { seedAtCourse } from "../helpers/at-admin-fixtures";

test.describe("AI Tutor ADMIN — sign-in and landing", () => {
  test("signs in through Core's form and lands on AI Tutor's dashboard as ADMIN", async ({
    page,
  }) => {
    // Account setup is a fixture; the sign-in itself is walked through the real
    // Core login form, because AI Tutor has no login page of its own — it only
    // consumes a Core session cookie. Sign-up auto-signs-in, so drop that
    // session first or Core's login loader redirects straight past the form.
    const user = await registerUser(page.request, { prefix: "at-admin-login" });
    await promoteUser(page.request, user.email, "ADMIN");
    await signOut(page.request);

    await page.goto(
      `${CORE_URL}/login?redirect=${encodeURIComponent(`${AI_TUTOR_URL}/dashboard`)}`,
    );
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/password/i).fill(DEFAULT_PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await page.waitForURL(/localhost:3001/, { timeout: 30_000 });
    await expect(page.getByText("Platform overview")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(user.email)).toBeVisible();
  });

  test("root path routes an admin to the shared dashboard", async ({ page }) => {
    await createAdmin(page.request, { prefix: "at-admin-root" });
    await page.goto(`${AI_TUTOR_URL}/`);
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    await expect(page.getByText("Platform overview")).toBeVisible();
  });
});

test.describe("AI Tutor ADMIN — sidebar navigation", () => {
  test("sidebar offers exactly Dashboard, Courses, Admin, and Help", async ({ page }) => {
    await loginAsAdmin(page, "at-admin-nav");

    const nav = sidebar(page);
    for (const label of ["Dashboard", "Courses", "Admin", "Help"]) {
      await expect(nav.getByRole("link", { name: label, exact: true }).first()).toBeVisible();
    }
    // The student shell's own entry point must not be offered to an admin.
    await expect(nav.getByRole("link", { name: "My courses", exact: true })).toHaveCount(0);
  });

  test("Courses in the sidebar opens the platform-wide course list", async ({ page }) => {
    await loginAsAdmin(page, "at-admin-nav-courses");
    await sidebar(page).getByRole("link", { name: "Courses", exact: true }).first().click();
    await expect(page).toHaveURL(/\/instructor$/);
    await expect(page.getByText("Browse your courses and manage their content.")).toBeVisible();
  });

  test("Admin in the sidebar opens the admin console", async ({ page }) => {
    await loginAsAdmin(page, "at-admin-nav-admin");
    await sidebar(page).getByRole("link", { name: "Admin", exact: true }).first().click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Admin console" })).toBeVisible();
  });

  test("the user menu exposes Settings and Log out", async ({ page }) => {
    const admin = await loginAsAdmin(page, "at-admin-usermenu");
    await page.locator("button").filter({ hasText: admin.email }).first().click();
    const menu = page.locator('[role="menu"]');
    await expect(menu).toBeVisible();
    await expect(menu.getByText("Settings")).toBeVisible();
    await expect(menu.getByText(/log out/i)).toBeVisible();
  });
});

test.describe("AI Tutor ADMIN — command palette", () => {
  test("opens with Ctrl+K and lists the admin's navigation targets", async ({ page }) => {
    await loginAsAdmin(page, "at-admin-palette");
    await page.keyboard.press("Control+k");

    const palette = page.locator('[role="dialog"]');
    await expect(palette).toBeVisible();
    for (const label of ["Dashboard", "Courses", "Admin", "Settings", "Help"]) {
      await expect(palette.getByText(label, { exact: true }).first()).toBeVisible();
    }

    // The security claim is that the palette reuses `getNavForUser`, so it can
    // never offer a route the sidebar withholds. Assert the negative too:
    // the student shell's own entry has no palette target for an admin.
    await expect(palette.getByText("My courses", { exact: true })).toHaveCount(0);
    const targets = await palette.locator("[cmdk-item], [role='option']").all();
    for (const target of targets) {
      await expect(target).not.toHaveAttribute("data-value", /student/i);
    }
  });

  test("typing narrows the palette and Enter navigates to the admin console", async ({ page }) => {
    await loginAsAdmin(page, "at-admin-palette-nav");
    await page.keyboard.press("Control+k");
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    await page.keyboard.type("Admin");
    await expect(page.locator('[role="dialog"]').getByText("Admin", { exact: true })).toBeVisible();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Admin console" })).toBeVisible();
  });
});

test.describe("AI Tutor ADMIN — suite switcher and chrome", () => {
  test("the app launcher lists the whole suite and marks AI Tutor as current", async ({ page }) => {
    await loginAsAdmin(page, "at-admin-launcher");
    await page.getByRole("button", { name: /switch app/i }).click();

    const menu = page.locator('[role="menu"]');
    await expect(menu).toBeVisible();
    // Core and QM are links out; the current app carries no href.
    await expect(menu.getByRole("menuitem", { name: /EduAI Core/ })).toHaveAttribute(
      "href",
      /localhost:3000/,
    );
    await expect(menu.getByRole("menuitem", { name: /Question Maker/ })).toHaveAttribute(
      "href",
      /localhost:5173/,
    );
    await expect(menu.getByRole("menuitem", { name: /AI Tutor/ })).not.toHaveAttribute("href", /./);
  });

  test("the theme toggle flips the shell between light and dark", async ({ page }) => {
    await loginAsAdmin(page, "at-admin-theme");
    const toggle = page.getByRole("button", { name: /switch to (dark|light) mode/i });
    const before = await toggle.getAttribute("aria-label");
    await toggle.click();
    await expect(toggle).not.toHaveAttribute("aria-label", before ?? "");
  });

  test("the bug-report dialog is available from every shell page", async ({ page }) => {
    await loginAsAdmin(page, "at-admin-bugbutton");
    await page.getByRole("button", { name: /report a bug/i }).click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.getByText("Report a bug")).toBeVisible();
    await expect(dialog.getByTestId("bug-type")).toBeVisible();
    await expect(dialog.getByTestId("bug-description")).toBeVisible();
  });
});

test.describe("AI Tutor ADMIN — Help", () => {
  test("Help shows the administrator guidance section", async ({ page }) => {
    await loginAsAdmin(page, "at-admin-help");
    await sidebar(page).getByRole("link", { name: "Help", exact: true }).first().click();

    await expect(page).toHaveURL(/\/help$/);
    await expect(page.getByRole("heading", { name: /Help & guide/i })).toBeVisible();
    await expect(page.getByText("Administrator", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/For admins/i).first()).toBeVisible();
  });
});

test.describe("AI Tutor ADMIN — routes an admin is kept out of", () => {
  for (const path of ["/student", "/student/courses/1", "/student/module/1", "/student/lesson/1"]) {
    test(`${path} answers an ADMIN with a 404 rather than a silent bounce`, async ({ page }) => {
      // These used to redirect to /dashboard, which reads as a glitch — the
      // reader asked for one page and silently got another. A 404 also keeps
      // the app from confirming the page exists to someone who may not open it.
      await createAdmin(page.request, { prefix: "at-admin-blocked" });
      await page.goto(`${AI_TUTOR_URL}${path}`);

      await expect(page.getByText("404 — Page not found")).toBeVisible({ timeout: 30_000 });
      // The URL is left alone, so a reload retries the page that was asked for.
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      // Still inside the shell, with a way onwards.
      await expect(page.getByRole("link", { name: "Admin", exact: true }).first()).toBeVisible();
      await page.getByRole("link", { name: /go to dashboard/i }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
    });
  }

  test("a URL that matches no route is a 404 inside the shell", async ({ page }) => {
    await createAdmin(page.request, { prefix: "at-admin-nosuchroute" });
    await page.goto(`${AI_TUTOR_URL}/no-such-page`);

    await expect(page.getByText("404 — Page not found")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/An unexpected error occurred/i)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Dashboard", exact: true }).first()).toBeVisible();
  });
});

test.describe("AI Tutor ADMIN — Settings", () => {
  test("the Account tab shows the signed-in admin and their role", async ({ page }) => {
    const admin = await loginAsAdmin(page, "at-admin-settings-account");
    await gotoAiTutor(page, "/settings");

    await expect(
      page.getByText("Manage your account, accessibility preferences, and AI provider keys."),
    ).toBeVisible();
    await expect(page.getByText("Profile", { exact: true })).toBeVisible();
    await expect(page.getByText(admin.email).first()).toBeVisible();
    await expect(page.getByText("Admin", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^log out$/i })).toBeVisible();
  });

  test("the Accessibility tab exposes assistive mode, motion, density, and theme", async ({
    page,
  }) => {
    await loginAsAdmin(page, "at-admin-settings-a11y");
    await gotoAiTutor(page, "/settings");
    await openTab(page, "Accessibility");

    await expect(page.getByText("Assistive Mode")).toBeVisible();
    await expect(page.getByText("Reduce motion")).toBeVisible();
    await expect(page.getByText("Density")).toBeVisible();
    await expect(page.getByText(/Personalize how AI Tutor looks and feels/i)).toBeVisible();
  });

  test("the Providers tab offers per-user keys and says they stay in the browser", async ({
    page,
  }) => {
    await loginAsAdmin(page, "at-admin-settings-providers");
    await gotoAiTutor(page, "/settings");
    await openTab(page, "Providers");

    await expect(page.getByText("Model providers", { exact: true })).toBeVisible();
    // The distinction from the admin-managed EduAI key matters: these are
    // browser-local BYOK keys, never persisted server-side. The copy also
    // says they leave the browser only to be validated or used.
    await expect(page.getByText(/Keys are stored for this account in this browser/)).toBeVisible();
    await expect(page.getByText(/Signing out removes them from this browser/)).toBeVisible();
    await expect(page.getByText("Gemini")).toBeVisible();
    await expect(page.getByText("OpenAI")).toBeVisible();
  });
});

test.describe("AI Tutor ADMIN — sign-out", () => {
  test("Settings → Log out returns to Core's login and protected routes bounce", async ({
    page,
  }) => {
    await loginAsAdmin(page, "at-admin-logout");

    await gotoAiTutor(page, "/settings");
    await page.getByRole("button", { name: /^log out$/i }).click();

    await expect(page).toHaveURL(/localhost:3000\/auth\/login/, { timeout: 30_000 });
    await expect(page.getByText(/Sign in to your UBC EduAI account/i)).toBeVisible();

    // The session is gone, so an authenticated AI Tutor route now bounces back
    // to Core's login carrying a redirect for the page that was asked for.
    await page.goto(`${AI_TUTOR_URL}/dashboard`);
    await expect(page).toHaveURL(/localhost:3000\/auth\/login.*redirect=.*dashboard/, {
      timeout: 30_000,
    });

    // `buildCoreLoginUrl` adds force=1 so Core shows the form instead of
    // bouncing a still-valid cookie straight back.
    await expect(page).toHaveURL(/force=1/);

    // And the session really is gone server-side, not just client-side.
    const me = await page.request.get(`${AI_TUTOR_API_URL}/api/me`);
    expect(me.status()).toBe(401);
  });
});

test.describe("AI Tutor ADMIN — shell affordances scoped to other roles", () => {
  test("the guided tour is not offered to an admin", async ({ page }) => {
    // `canAccessStudentTour` is STUDENT/TA only, so the sparkle button never
    // renders for an admin — correct. Recorded because Help still tells admins
    // to look for it (see the Help finding in the workflow doc).
    await loginAsAdmin(page, "at-admin-no-tour");
    await gotoAiTutor(page, "/instructor");
    await expect(page.getByRole("button", { name: /take tour/i })).toHaveCount(0);
  });

  test("/unsupported-role bounces a supported role back to the dashboard", async ({ page }) => {
    // The page exists for roles AI Tutor cannot serve; an ADMIN is supported,
    // so `routeForRole` sends them home rather than showing the dead end.
    await createAdmin(page.request, { prefix: "at-admin-unsupported" });
    await page.goto(`${AI_TUTOR_URL}/unsupported-role`);
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    await expect(page.getByText("Platform overview")).toBeVisible();
  });
});

test.describe("AI Tutor ADMIN — breadcrumb course switcher", () => {
  test("switches between two courses without going back to the list", async ({
    page,
    playwright,
  }) => {
    // Help advertises this ("the course name in the breadcrumb doubles as a
    // switcher") and #1208 made its list server-searched, but nothing exercised
    // it. For an admin the list is platform-wide, so it reaches a course they
    // do not teach.
    // Names must be globally unique: the switcher searches the whole platform
    // server-side, so a fixed name can collide with a course another spec left
    // behind and the click lands on the wrong row.
    const stamp = Date.now();
    const first = await seedAtCourse(playwright, {
      name: `Switcher Course One ${stamp}`,
      codePrefix: "SWA",
    });
    const second = await seedAtCourse(playwright, {
      name: `Switcher Course Two ${stamp}`,
      codePrefix: "SWB",
    });
    try {
      await loginAsAdmin(page, "at-admin-switcher");
      await gotoAiTutor(page, `/instructor/courses/${first.atCourseId}`);
      await expect(page.getByRole("heading", { name: first.name })).toBeVisible({
        timeout: 20_000,
      });

      await page.getByRole("button", { name: "Switch course" }).click();
      // Server-side search, so type rather than scroll a page-bounded list, and
      // wait for the debounced results to settle to exactly this course before
      // clicking — otherwise the click can land on the previous query's rows.
      await page.getByRole("searchbox").fill(second.name);
      // The shared switcher renders rows as Radix `menuitem`s, and `splitTitle`
      // may show only part of the title, so match on the unique stamp.
      const option = page.getByRole("menuitem").filter({ hasText: String(stamp) });
      await expect(option).toHaveCount(1, { timeout: 20_000 });
      await option.click();

      await expect(page).toHaveURL(new RegExp(`/instructor/courses/${second.atCourseId}$`), {
        timeout: 20_000,
      });
      await expect(page.getByRole("heading", { name: second.name })).toBeVisible();
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });
});
