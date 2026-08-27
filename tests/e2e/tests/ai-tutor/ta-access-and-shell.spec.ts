/**
 * AI Tutor — TA access and app-shell workflows, driven through the browser.
 *
 * A "TA" is not a platform role: it is a STUDENT-platform user carrying an
 * `EnrollmentRole.TA` enrolment on at least one course. AI Tutor resolves that
 * to an *effective* client role `"TA"` in `GET /api/me`
 * (`server/src/routes/authentication.js` — `userHasCoreTaEnrollment`), which
 * drives the whole client shell: `getNavForUser` gives a TA the instructor
 * "Courses" entry (`usesInstructorShell`), `canAccessStudentTour` offers the
 * tour, and only `/admin` is withheld.
 *
 * Companion specs: ta-dashboard, ta-course-oversight, ta-grading,
 * ta-learner-access, ta-settings, ta-security. Path inventory and findings live
 * in `docs/end-to-end-user-workflows/ai-tutor-workflows.md` (TA section).
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_API_URL, AI_TUTOR_URL, CORE_URL } from "../../playwright.config";
import { DEFAULT_PASSWORD, signOut } from "../helpers/auth";
import { gotoAiTutor, sidebar } from "../helpers/at-ui";
import { registerStudent, seedPublishedCourseAndEnroll } from "../helpers/at-student-fixtures";

/**
 * Register a fresh STUDENT-platform user, enrol them as TA on a published
 * course owned by a different instructor, and leave the browser signed in as
 * them. After this the page carries a session whose `GET /api/me` reports the
 * effective role `"TA"`.
 */
async function signInAsTa(
  page: import("@playwright/test").Page,
  playwright: {
    request: { newContext: () => Promise<import("@playwright/test").APIRequestContext> };
  },
  codePrefix = "TA",
) {
  const { studentId } = await registerStudent(page);
  const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
    name: "TA Shell Course",
    codePrefix,
    role: "TA",
  });
  return { studentId, seeded };
}

test.describe("AI Tutor TA — sign-in and landing", () => {
  test("a course TA resolves to the effective role TA and lands on the dashboard", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await signInAsTa(page, playwright, "TAL");
    try {
      // AI Tutor has no login of its own — the Core session cookie is enough.
      // A user with a TA enrolment is promoted to the effective role TA in /me.
      const me = await page.request.get(`${AI_TUTOR_API_URL}/api/me`);
      expect(me.status()).toBe(200);
      expect((await me.json())?.user?.role).toBe("TA");

      await gotoAiTutor(page, "/");
      await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor TA — sidebar navigation", () => {
  test("sidebar offers Dashboard, Courses, and Help — no Admin, and Courses is the staff shell", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await signInAsTa(page, playwright, "TAN");
    try {
      await gotoAiTutor(page, "/dashboard");
      const nav = sidebar(page);
      for (const label of ["Dashboard", "Courses", "Help"]) {
        await expect(nav.getByRole("link", { name: label, exact: true }).first()).toBeVisible();
      }
      // A TA is course teaching staff, so their single "Courses" entry is the
      // instructor shell (`usesInstructorShell`), never the admin console.
      await expect(nav.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
    } finally {
      await seeded.dispose();
    }
  });

  test("Courses in the sidebar opens the instructor (staff) course list, not /student", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await signInAsTa(page, playwright, "TNC");
    try {
      await gotoAiTutor(page, "/dashboard");
      await sidebar(page).getByRole("link", { name: "Courses", exact: true }).first().click();
      // `getNavForUser` points a TA's Courses entry at `/instructor` — the
      // learner `/student` list is reachable only by direct URL.
      await expect(page).toHaveURL(/\/instructor$/, { timeout: 20_000 });
      await expect(page.getByRole("link", { name: new RegExp(seeded.name) }).first()).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await seeded.dispose();
    }
  });

  test("the user menu exposes Settings and Log out", async ({ page, playwright }) => {
    const { seeded } = await signInAsTa(page, playwright, "TUM");
    try {
      await gotoAiTutor(page, "/dashboard");
      // The account button in the sidebar carries the TA's own email.
      const me = await (await page.request.get(`${AI_TUTOR_API_URL}/api/me`)).json();
      await page.locator("button").filter({ hasText: me.user.email }).first().click();
      const menu = page.locator('[role="menu"]');
      await expect(menu).toBeVisible();
      await expect(menu.getByText("Settings")).toBeVisible();
      await expect(menu.getByText(/log out/i)).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor TA — command palette", () => {
  test("opens with Ctrl+K and lists only the TA's navigation targets", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await signInAsTa(page, playwright, "TPL");
    try {
      await gotoAiTutor(page, "/dashboard");
      await page.keyboard.press("Control+k");
      const palette = page.locator('[role="dialog"]');
      await expect(palette).toBeVisible();
      for (const label of ["Dashboard", "Courses", "Settings", "Help"]) {
        await expect(palette.getByText(label, { exact: true }).first()).toBeVisible();
      }
      // The palette reuses `getNavForUser`, so it can never surface the admin
      // console to a TA.
      await expect(palette.getByText("Admin", { exact: true })).toHaveCount(0);
    } finally {
      await seeded.dispose();
    }
  });

  test("typing narrows the palette and Enter navigates to the staff course list", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await signInAsTa(page, playwright, "TPN");
    try {
      await gotoAiTutor(page, "/dashboard");
      await page.keyboard.press("Control+k");
      await expect(page.locator('[role="dialog"]')).toBeVisible();
      await page.keyboard.type("Courses");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/instructor$/, { timeout: 15_000 });
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor TA — suite switcher and chrome", () => {
  test("the app launcher lists the suite and marks AI Tutor as current", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await signInAsTa(page, playwright, "TSW");
    try {
      await gotoAiTutor(page, "/dashboard");
      await page.getByRole("button", { name: /switch app/i }).click();
      const menu = page.locator('[role="menu"]');
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: /EduAI Core/ })).toHaveAttribute(
        "href",
        /localhost:3000/,
      );
      await expect(menu.getByRole("menuitem", { name: /AI Tutor/ })).not.toHaveAttribute(
        "href",
        /./,
      );
    } finally {
      await seeded.dispose();
    }
  });

  test("the theme toggle flips the shell between light and dark", async ({ page, playwright }) => {
    const { seeded } = await signInAsTa(page, playwright, "TTH");
    try {
      await gotoAiTutor(page, "/dashboard");
      const toggle = page.getByRole("button", { name: /switch to (dark|light) mode/i });
      const before = await toggle.getAttribute("aria-label");
      await toggle.click();
      await expect(toggle).not.toHaveAttribute("aria-label", before ?? "");
    } finally {
      await seeded.dispose();
    }
  });

  test("a TA can submit a bug report from the shell", async ({ page, playwright }) => {
    const { seeded } = await signInAsTa(page, playwright, "TBG");
    try {
      await gotoAiTutor(page, "/dashboard");
      await page.getByRole("button", { name: /report a bug/i }).click();
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog.getByText("Report a bug")).toBeVisible();
      await dialog.getByTestId("bug-type").click();
      await page.locator('[role="option"]').first().click();
      await dialog.getByTestId("bug-description").fill(`E2E TA bug probe ${Date.now()}`);
      await dialog.getByRole("button", { name: /submit report/i }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor TA — Help and guided tour", () => {
  test("Help shows the guide, and the guided tour IS offered to a TA", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await signInAsTa(page, playwright, "THP");
    try {
      await gotoAiTutor(page, "/help");
      await expect(page.getByRole("heading", { name: /Help & guide/i })).toBeVisible();

      // `canAccessStudentTour` is STUDENT/TA (and, uniquely for a TA, on the
      // instructor shell too), so the sparkle "Take tour" button must render.
      await gotoAiTutor(page, "/student");
      await expect(page.getByRole("button", { name: /take tour/i })).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor TA — the one route a TA is kept out of", () => {
  test("/admin answers a TA with an in-shell 404 rather than a silent bounce", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await signInAsTa(page, playwright, "TAD");
    try {
      await page.goto(`${AI_TUTOR_URL}/admin`);
      await expect(page.getByText("404 — Page not found")).toBeVisible({ timeout: 30_000 });
      await expect(page).toHaveURL(/\/admin$/);
      await expect(
        page.getByRole("link", { name: "Dashboard", exact: true }).first(),
      ).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });

  test("a URL that matches no route is a 404 inside the shell", async ({ page, playwright }) => {
    const { seeded } = await signInAsTa(page, playwright, "TNR");
    try {
      await page.goto(`${AI_TUTOR_URL}/no-such-page`);
      await expect(page.getByText("404 — Page not found")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/An unexpected error occurred/i)).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "Dashboard", exact: true }).first(),
      ).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor TA — sign-out", () => {
  test("Settings → Log out returns to Core's login and protected routes bounce", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await signInAsTa(page, playwright, "TSO");
    try {
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
    } finally {
      await seeded.dispose();
    }
  });
});
