/**
 * AI Tutor UNIT_ADMIN — the admin console is closed to this role.
 *
 * `/admin` is platform administration: bug-report triage, platform-wide AI
 * configuration, and cross-course AI oversight. None of it is a unit
 * administrator's job, so `routes/admin.tsx` admits ADMIN only and
 * `requireClientUser` answers a unit admin with a 404 rendered inside the
 * shell. `getNavForUser()` has always hidden the sidebar entry
 * (`canAccessAdminConsole()` is ADMIN-only); the route now agrees with it.
 *
 * The console used to admit UNIT_ADMIN with its tab list collapsed to a single
 * "AI oversight" tab. That is gone. What has NOT changed is the server: `GET
 * /admin/ai-traces` still admits a unit admin, scoped to `authorizedUnits`
 * (#1187, and its own PICT model in `server/tests/integration/`). The last two
 * tests here pin that endpoint deliberately — it is now a capability with no
 * screen behind it, which is a decision to make rather than a fact to assume.
 *
 * Filing a bug report is a different thing from triaging one and is open to
 * every role from the header; that stays covered here so the asymmetry cannot
 * quietly become "unit admins can do neither".
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_API_URL, AI_TUTOR_URL } from "../../playwright.config";
import { signInThroughPage } from "../helpers/auth";
import {
  createUnitAdmin,
  OUT_OF_UNIT_DEPARTMENT,
  type UnitAdminFixture,
} from "../helpers/at-unit-admin";
import { errorBoundary, sidebarLink } from "../helpers/at-ui";

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

test.describe("UNIT_ADMIN and the admin console", () => {
  test("SECURITY: opening /admin by URL gives a unit admin the generic 404", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/admin`);

    await expect(errorBoundary(page)).toBeVisible();

    // Nothing from the console leaks through the boundary — not the heading,
    // not the tab set, not the copy that used to be narrowed for this role.
    await expect(page.getByRole("heading", { name: "Admin console" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "AI oversight" })).toHaveCount(0);
    await expect(page.getByText("Review AI tutoring activity in your unit.")).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(0);
  });

  test("the 404 keeps the unit admin inside the shell with a way out", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/admin`);
    await expect(errorBoundary(page)).toBeVisible();

    // `RouteErrorState` sits on the child route, not on `_app.tsx`, so the
    // sidebar and header survive a refused route. A refusal that stranded the
    // reader on a bare page would be a regression, not a stricter gate.
    await expect(sidebarLink(page, "/dashboard")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to dashboard" })).toBeVisible();
    // Still no Admin entry to have arrived from.
    await expect(sidebarLink(page, "/admin")).toHaveCount(0);
  });

  test("SECURITY: the ADMIN-only console routes stay closed to a unit admin", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    // The client gate is not the only gate: every route the console reads from
    // refuses this session on its own.
    const adminOnly = [
      "/api/admin/users",
      "/api/admin/courses",
      "/api/admin/bug-reports",
      "/api/admin/settings/eduai-api-key",
      "/api/admin/settings/ai-model-policy",
    ];

    for (const path of adminOnly) {
      const res = await page.request.get(`${AI_TUTOR_API_URL}${path}`);
      expect(res.status(), `${path} must be 403 for UNIT_ADMIN`).toBe(403);
    }
  });

  test("SECURITY: enrollment sync is ADMIN-only, not unit-admin", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    const res = await page.request.post(
      `${AI_TUTOR_API_URL}/api/admin/courses/${ua.course.atCourseId}/sync-enrollments`,
      { data: {} },
    );
    expect(res.status()).toBe(403);
  });

  test("a unit admin can still file a bug report even though triage is closed", async ({
    page,
  }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    await page.getByRole("button", { name: "Report a bug" }).click();

    const dialog = page.getByRole("dialog", { name: "Report a bug" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Describe the issue you encountered.")).toBeVisible();
    await expect(dialog.getByText("Bug type")).toBeVisible();
    await expect(dialog.getByText("Submit anonymously")).toBeVisible();
    // canSubmitBugReport() admits any authenticated role.
    await expect(dialog.getByRole("button", { name: "Submit report" })).toBeVisible();
  });

  test("a unit admin's bug report validates and then submits", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);
    await page.getByRole("button", { name: "Report a bug" }).click();
    const dialog = page.getByRole("dialog", { name: "Report a bug" });

    // Both fields are required, and the dialog says which is missing rather than
    // failing silently or posting a half-filled report.
    await dialog.getByRole("button", { name: "Submit report" }).click();
    await expect(dialog.getByText("Please provide at least 10 characters")).toBeVisible();
    await expect(dialog.getByText("Please select a bug type")).toBeVisible();
    await expect(dialog).toBeVisible();

    await dialog.getByTestId("bug-type").click();
    // Exactly as `BUG_TYPE_LABELS` spells it — the dialog and the triage table
    // both render from that one map (#1592 ended the "UI / display issue" vs
    // "UI / display" drift), and role-name matching is a substring test, so a
    // label with an extra word appended matches nothing at all.
    await page.getByRole("option", { name: "Access / permission", exact: true }).click();
    await dialog
      .getByTestId("bug-description")
      .fill("E2E: filed by a unit admin, who cannot triage it themselves.");

    await dialog.getByRole("button", { name: "Submit report" }).click();

    // The dialog closes only on a resolved submit — an error would keep it open
    // with an inline message, so this is the write actually landing.
    await expect(dialog).toHaveCount(0);

    // Filing is open to this role; triage is not. Both halves in one test, so
    // the asymmetry cannot silently drift into "unit admins can do neither".
    const triage = await page.request.get(`${AI_TUTOR_API_URL}/api/admin/bug-reports`);
    expect(triage.status()).toBe(403);
  });

  test("the AI-trace endpoint still admits a unit admin, with no screen behind it", async ({
    page,
  }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    // Deliberately pinned, not celebrated. The console that consumed this is
    // gone for the role, so a 200 here is a live capability the app no longer
    // surfaces — either the endpoint should close to UNIT_ADMIN too, or the
    // oversight view needs a home outside `/admin`. Failing this test is the
    // signal that someone made that call.
    const res = await page.request.get(
      `${AI_TUTOR_API_URL}/api/admin/ai-traces?limit=10&unit=${ua.units[0]}`,
    );
    expect(res.status()).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  test("SECURITY: trace oversight for an unauthorized unit is refused", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    // Whatever happens to the console, the endpoint's department scope must
    // hold — a unit admin must never read another unit's AI traces.
    const res = await page.request.get(
      `${AI_TUTOR_API_URL}/api/admin/ai-traces?limit=10&unit=${OUT_OF_UNIT_DEPARTMENT}`,
    );
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toBe("Not authorized for this unit");
  });
});
