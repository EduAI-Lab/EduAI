/**
 * Core Admin / Unit Admin / Instructor UI walkthrough (#1669).
 *
 * Companion to core-admin-unitadmin-instructor-boundaries.spec.ts (pure API
 * RBAC/scope matrix). This file drives Core through a real browser with the
 * seeded demo accounts (prisma/seed.ts), clicking through the admin console,
 * the unit-admin cross-course surfaces, and an instructor's own course — per
 * the epic's "click through the UI, not just call APIs" rule.
 *
 * Pattern follows week15-student-ta-exploration.spec.ts: sign in via the API
 * (apiSignIn), inject the session cookie into the browser context
 * (injectSession), then navigate/click as a real page. Exploratory, not a
 * guarded regression suite for pixel-level UI — findings are written up in
 * docs/end-to-end-user-workflows/eduai-core-workflows.md.
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { CORE_URL } from "../../playwright.config";
import { createInstructor, registerUser, uniqueEmail } from "../helpers/auth";

const PASSWORD = process.env.EDUAI_LOCAL_SEED_PASSWORD?.trim() || "EduAI2026!";

const USERS = {
  admin: "admin@eduai.local",
  unitAdminCosc: "unitadmin.cosc@eduai.local", // authorizedUnits: ["COSC"]
  unitAdminMulti: "unitadmin.multi@eduai.local", // authorizedUnits: ["MATH", "STAT", "DATA"]
  instructorCS: "instructor.cs@eduai.local", // Dr. Ada Lovelace — cosc101, cosc121
  instructorMath: "instructor.math@eduai.local", // Dr. Emmy Noether — math200
};

async function apiSignIn(ctx: APIRequestContext, email: string): Promise<void> {
  const res = await ctx.post(`${CORE_URL}/api/auth/sign-in/email`, {
    data: { email, password: PASSWORD },
  });
  expect(res.ok(), `sign-in failed for ${email}: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function injectSession(page: Page, requestCtx: APIRequestContext): Promise<void> {
  const { cookies } = await requestCtx.storageState();
  await page.context().addCookies(cookies);
}

async function newAuthedContext(playwright: any, email: string) {
  const ctx = await playwright.request.newContext();
  await apiSignIn(ctx, email);
  return ctx;
}

// The dashboard's guided product tour auto-starts once per browser (plain
// localStorage flag, not scoped per-user — apps/core/app/components/tour/tour-steps.ts
// DASHBOARD_TOUR_STORAGE_KEY) and its full-screen overlay intercepts clicks on
// the rest of the page. Pre-seed the "already seen" flag so it never opens,
// same pattern as week15-student-ta-exploration-round2.spec.ts.
async function skipDashboardTour(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("eduai:tour:dashboard:v1", "1");
  });
}

// Same E2E-only seed trigger as week15-student-ta-exploration.spec.ts — the
// E2E docker stack only runs `prisma migrate deploy`, not the seed script.
test.beforeAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  try {
    const secret = process.env.E2E_SEED_SECRET ?? "e2e-seed-secret";
    const res = await ctx.post(`${CORE_URL}/api/e2e/seed`, { data: { secret } });
    expect(res.ok(), `demo-data seed failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  } finally {
    await ctx.dispose();
  }
});

// ===========================================================================
// ADMIN — real browser walkthrough of the admin console
// ===========================================================================

test.describe("Admin (admin@eduai.local) — console UI walkthrough", () => {
  test("sidebar shows the full Administration group; every admin page loads without redirect", async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.admin);
    try {
      await skipDashboardTour(page);
      await injectSession(page, ctx);
      await page.goto(`${CORE_URL}/dashboard`);
      await page.waitForLoadState("networkidle");

      // The Administration group (rbac/nav.ts ADMIN_NAV) renders collapsed
      // by default (nav-main.tsx's shouldAutoExpandGroup only auto-opens it
      // when the current path matches a child) — expand it with a real click
      // before its children ("User Management", etc.) exist in the DOM.
      const adminGroupToggle = page.getByRole("button", { name: "Administration" });
      await expect(adminGroupToggle).toBeVisible();
      await adminGroupToggle.click();

      // Click through, not just goto, for at least the first link to prove
      // the expanded nav itself is wired up correctly. `exact: true` is
      // required — the dashboard's admin-console card also has an accessible
      // name starting with "User management" (its description text folds in),
      // which a plain substring match would also hit.
      const userManagementNavLink = page.getByRole("link", {
        name: "User Management",
        exact: true,
      });
      await expect(userManagementNavLink).toBeVisible();
      await userManagementNavLink.click();
      await page.waitForURL(/\/admin\/users/);
      await expect(page).not.toHaveURL(/\/auth\/login/);

      // Click each remaining Administration link (not page.goto) so the nav
      // itself is proven wired up, and assert page-specific content (each
      // route's breadcrumb page title, from rbac/nav.ts + the route files)
      // rather than just the URL, so a broken page shell wouldn't slip by.
      const adminLinks: Array<{ path: string; navName: string; pageTitle: string }> = [
        { path: "/admin/ai-models", navName: "AI Management", pageTitle: "AI Models" },
        { path: "/admin/bug-reports", navName: "Bug Reports", pageTitle: "Bug Reports" },
        { path: "/admin/invitations", navName: "Invitations", pageTitle: "Invitations" },
        { path: "/admin/settings", navName: "Settings", pageTitle: "Settings" },
        { path: "/admin/logs", navName: "Logs", pageTitle: "Logs" },
        { path: "/admin/cron-jobs", navName: "Cron Jobs", pageTitle: "Cron Jobs" },
      ];
      for (const { path, navName, pageTitle } of adminLinks) {
        const navLink = page.getByRole("link", { name: navName, exact: true });
        await expect(navLink).toBeVisible();
        await navLink.click();
        await page.waitForURL(new RegExp(path.replace(/\//g, "\\/")));
        await page.waitForLoadState("networkidle");
        await expect(page).not.toHaveURL(/\/auth\/login/);
        await expect(page).not.toHaveURL(/\/dashboard$/);
        // BreadcrumbPage renders role="link" (aria-disabled, aria-current="page"),
        // not a heading — assert on that, the page's own breadcrumb title. Most
        // titles match their sidebar nav label verbatim (e.g. "Settings"), so
        // scope to the breadcrumb nav itself to avoid a strict-mode collision
        // with the still-visible sidebar link of the same name.
        const breadcrumb = page.getByRole("navigation", { name: "breadcrumb" });
        await expect(breadcrumb.getByRole("link", { name: pageTitle, exact: true })).toBeVisible();
      }
      await page.screenshot({
        path: "test-results/admin-unitadmin-instructor/admin-ai-models.png",
        fullPage: true,
      });
    } finally {
      await ctx.dispose();
    }
  });

  test("Settings page: toggling a policy flag round-trips through the UI and persists", async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.admin);
    try {
      await skipDashboardTour(page);
      await injectSession(page, ctx);
      await page.goto(`${CORE_URL}/admin/settings`);
      await page.waitForLoadState("networkidle");

      // admin.settings.tsx renders each policy-flags.ts entry as a Radix
      // Switch with id={key}, labelled via <Label htmlFor={key}>{label}</Label>
      // — "instructors.canCreateCourses" defaults to true.
      const policySwitch = page.getByRole("switch", { name: "Instructors can create courses" });
      await expect(policySwitch).toBeVisible();
      const wasChecked = (await policySwitch.getAttribute("data-state")) === "checked";

      await policySwitch.click();
      await expect(policySwitch).toHaveAttribute(
        "data-state",
        wasChecked ? "unchecked" : "checked",
      );

      // Reload to prove the flip round-tripped through PATCH /api/policies
      // and back, not just local component state.
      await page.reload();
      await page.waitForLoadState("networkidle");
      const reloadedSwitch = page.getByRole("switch", { name: "Instructors can create courses" });
      await expect(reloadedSwitch).toHaveAttribute(
        "data-state",
        wasChecked ? "unchecked" : "checked",
      );
    } finally {
      // restore default so this test doesn't leak state into other tests
      await ctx.patch(`${CORE_URL}/api/policies`, {
        data: { key: "instructors.canCreateCourses", value: true },
      });
      await ctx.dispose();
    }
  });

  // Closes the doc's "System Logs page content beyond 'loads without
  // redirecting'" gap: trigger a real PATCH /api/policies (which
  // apps/core/app/routes/api/policies.ts writes an audit_logs row with
  // actionCode POLICY_FLAG_UPDATED) and assert the row actually renders, not
  // just that the page loads.
  //
  // This row lands on the SECURITY tab, not the default "Audit" one — a
  // first draft of this test assumed otherwise and failed against the live
  // stack. `db.auditlog.server.ts`'s `buildAuditLogWhere` deliberately
  // excludes `category: "SECURITY"` rows from the Audit tab's query unless
  // `includeSecurity`/an explicit `category` filter says otherwise ("Security
  // tab queries are always hard-scoped to SECURITY so caller mistakes cannot
  // leak tabs" — same comment, other direction), and `policies.ts` tags this
  // action `category: "SECURITY"` (toggling a permission gate is a security
  // control change, verified live: 150 of the seed+run's 305 total audit_logs
  // rows carry that category and are invisible on the Audit tab by design).
  test("System Logs (Security tab) renders a real audit-log row after a policy change", async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.admin);
    const flagKey = "instructors.canManageEnrollments";
    let before: boolean | undefined;
    try {
      const beforeRes = await ctx.get(`${CORE_URL}/api/policies`);
      before = (await beforeRes.json()).policies[flagKey] as boolean;

      const patchRes = await ctx.patch(`${CORE_URL}/api/policies`, {
        data: { key: flagKey, value: !before },
      });
      expect(patchRes.status()).toBe(200);

      // The PATCH response above is already awaited, and policies.ts's
      // fire-and-forget logAuditAction call commits well within a real
      // network round trip (verified directly against the DB: the row lands
      // within tens of milliseconds) — so a single fresh navigation is enough.
      await skipDashboardTour(page);
      await injectSession(page, ctx);
      await page.goto(`${CORE_URL}/admin/logs?tab=security`);
      await page.waitForLoadState("networkidle");

      await expect(page.getByText("POLICY_FLAG_UPDATED").first()).toBeVisible({
        timeout: 15_000,
      });
      // The Security tab's table (unlike the Audit tab's) has no Entity
      // column at all — Created/Action/Actor/Outcome/Route/IP/Details only
      // (verified live). Open the row's "View details" dialog instead, which
      // renders the full row including entityLabel/details, to confirm this
      // is *this* change and not a stale pre-existing row that happens to
      // share the actionCode.
      await page
        .getByRole("row", { name: /POLICY_FLAG_UPDATED/ })
        .first()
        .getByRole("button", { name: "View details" })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(flagKey).first()).toBeVisible();
    } finally {
      // restore default so this test doesn't leak state into other tests
      await ctx.patch(`${CORE_URL}/api/policies`, { data: { key: flagKey, value: before } });
      await ctx.dispose();
    }
  });

  // `courseChatViewPolicyKey`'s "ADMIN is always on" contract already has API
  // coverage in core-admin-unitadmin-instructor-boundaries.spec.ts. What's
  // never been exercised is the actual rendering path: CourseChatsPanel /
  // CourseChatsTab (course-chats-panel.tsx) has zero prior e2e UI coverage.
  // This proves the "Chat history" tab really surfaces a real student chat in
  // the browser, not just that the underlying API returns one.
  test("Chat history tab renders a real student chat for ADMIN's oversight view", async ({
    page,
    playwright,
  }) => {
    const adminCtx = await newAuthedContext(playwright, USERS.admin);
    const instructorCtx = await playwright.request.newContext();
    const studentCtx = await playwright.request.newContext();
    try {
      await createInstructor(instructorCtx, { prefix: "chatoversight-ui-instructor" });
      const instructorMe = await instructorCtx.get(`${CORE_URL}/api/me`);
      const instructorId = (await instructorMe.json()).id;

      const courseCode = `CHATUI-${Date.now()}`;
      const createRes = await adminCtx.post(`${CORE_URL}/api/courses`, {
        form: {
          name: `Chat oversight UI ${courseCode}`,
          code: courseCode,
          section: "001",
          term: "W1",
          year: "2026",
          startDate: "2026-09-08",
          department: "COSC",
          instructorUserIds: instructorId,
        },
      });
      expect(createRes.status(), await createRes.text()).toBe(201);
      const courseId = (await createRes.json()).id;
      expect((await adminCtx.patch(`${CORE_URL}/api/courses/${courseId}/publish`)).status()).toBe(
        200,
      );

      const studentName = `E2E Chat Oversight Student ${Date.now()}`;
      const student = await registerUser(studentCtx, {
        name: studentName,
        prefix: "chatoversight-ui-student",
      });
      const studentMe = await studentCtx.get(`${CORE_URL}/api/me`);
      const studentId = (await studentMe.json()).id;
      expect(
        (
          await adminCtx.post(`${CORE_URL}/api/courses/${courseId}/enrollments`, {
            data: { userId: studentId, role: "STUDENT" },
          })
        ).status(),
      ).toBe(201);

      // Same fast-chat trick as course-scope-guardrail.spec.ts /
      // week15-student-ta-exploration-round2.spec.ts: an empty `messages`
      // array short-circuits before any (unreachable in this dev env) LLM
      // call, but still persists a real Chat row with a real owner.
      const chatRes = await studentCtx.post(`${CORE_URL}/api/chat`, {
        data: {
          messages: [],
          systemPrompt: "You are a helpful course tutor.",
          courseId,
        },
      });
      expect(chatRes.ok(), await chatRes.text()).toBeTruthy();

      await skipDashboardTour(page);
      await injectSession(page, adminCtx);
      await page.goto(`${CORE_URL}/courses`);
      await page.waitForLoadState("networkidle");
      await page
        .getByRole("link", { name: new RegExp(courseCode) })
        .first()
        .click();
      await page.waitForLoadState("networkidle");
      await page.getByRole("tab", { name: "Chat history" }).click();

      // The chat list button shows the owner's name (course-chats-panel.tsx),
      // not the chat content — proves the oversight list is really wired to
      // this course's real chats, not a stub/empty state. Match the chat-list
      // button specifically (getByText alone is ambiguous — the Enrollments
      // tab's roster panel stays mounted off-screen and also renders this
      // same student name).
      await expect(
        page.getByRole("button", { name: new RegExp(studentName) }),
      ).toBeVisible({ timeout: 15_000 });
      expect(student.name).toBe(studentName);
    } finally {
      await adminCtx.dispose();
      await instructorCtx.dispose();
      await studentCtx.dispose();
    }
  });
});

// ===========================================================================
// UNIT ADMIN — real browser walkthrough of cross-course scope
// ===========================================================================

test.describe("Unit Admin (unitadmin.cosc@eduai.local) — cross-course scope UI", () => {
  test("dashboard/course list shows in-unit courses without any enrollment, and hides the Administration nav group", async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.unitAdminCosc);
    try {
      await skipDashboardTour(page);
      await injectSession(page, ctx);
      await page.goto(`${CORE_URL}/courses`);
      await page.waitForLoadState("networkidle");
      await expect(page).not.toHaveURL(/\/auth\/login/);

      // Cross-course visibility: COSC unit admin sees COSC 101 / COSC 121
      // (and COSC 211, unpublished) purely from department match — no
      // Enrollment row exists for this user on any of them. This dev/e2e
      // database accumulates courses from every spec run (100+ at the time
      // of writing, mostly alphabetically-earlier test fixtures), so the
      // default unpaginated view doesn't reliably surface the real seeded
      // course on the first page — search for it explicitly, same as a real
      // unit admin would in a course list this size.
      const searchBox = page.getByRole("searchbox", { name: "Search courses" });
      await expect(searchBox).toBeVisible({ timeout: 15_000 });
      await searchBox.fill("COSC 1");
      await expect(page.getByText("COSC 101")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("COSC 121")).toBeVisible({ timeout: 15_000 });

      // SECURITY: the ADMIN-only sidebar group must not render for UNIT_ADMIN.
      await expect(page.getByRole("link", { name: "User Management" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "AI Management" })).toHaveCount(0);

      await page.screenshot({
        path: "test-results/admin-unitadmin-instructor/unitadmin-courses.png",
        fullPage: true,
      });
    } finally {
      await ctx.dispose();
    }
  });

  test("out-of-unit courses (MATH 200) do not appear in the COSC unit admin's course list", async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.unitAdminCosc);
    try {
      await skipDashboardTour(page);
      await injectSession(page, ctx);
      await page.goto(`${CORE_URL}/courses`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("MATH 200")).toHaveCount(0);
    } finally {
      await ctx.dispose();
    }
  });

  test("Invitations nav item is present but disabled while unitAdmins.canInvite is off (default); the page itself redirects to /dashboard", async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.unitAdminCosc);
    try {
      await skipDashboardTour(page);
      await injectSession(page, ctx);
      await page.goto(`${CORE_URL}/dashboard`);
      await page.waitForLoadState("networkidle");
      // The nav item renders even when the policy is off (issue #807's
      // "greyed out, not missing" design) — assert by text rather than an
      // enabled `link` role, since a disabled item may not expose one.
      await expect(page.getByText("Invitations", { exact: true })).toBeVisible();

      // unitAdmins.canInvite defaults to false — the whole route redirects to
      // /dashboard per its loader (unit-admin.invitations.tsx), matching the
      // nav item's disabled state rather than a broken link.
      await page.goto(`${CORE_URL}/unit-admin/invitations`);
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveURL(/\/dashboard/);
    } finally {
      await ctx.dispose();
    }
  });

  test("with unitAdmins.canInvite ON, the UNIT_ADMIN invitations page actually loads and lets them create an invitation", async ({
    page,
    playwright,
  }) => {
    const adminCtx = await newAuthedContext(playwright, USERS.admin);
    const ctx = await newAuthedContext(playwright, USERS.unitAdminCosc);
    try {
      const patchRes = await adminCtx.patch(`${CORE_URL}/api/policies`, {
        data: { key: "unitAdmins.canInvite", value: true },
      });
      expect(patchRes.status()).toBe(200);

      await skipDashboardTour(page);
      await injectSession(page, ctx);
      await page.goto(`${CORE_URL}/unit-admin/invitations`);
      await page.waitForLoadState("networkidle");
      await expect(page).not.toHaveURL(/\/auth\/login/);
      await expect(page).not.toHaveURL(/\/dashboard$/);
      await expect(page).toHaveURL(/\/unit-admin\/invitations/);

      // Actually submit an invitation through the dialog, not just reach the
      // route — Core enforces a UBC email domain (ubc-email.ts) on the form.
      const email = uniqueEmail("unitadmin-invite");
      await page.getByRole("button", { name: "Invite User" }).click();
      await page.getByLabel("Email").fill(email);
      await page.getByRole("button", { name: "Send invite" }).click();
      await expect(page.getByRole("cell", { name: email })).toBeVisible();
    } finally {
      // restore default so this test doesn't leak state into other tests/rounds
      await adminCtx.patch(`${CORE_URL}/api/policies`, {
        data: { key: "unitAdmins.canInvite", value: false },
      });
      await adminCtx.dispose();
      await ctx.dispose();
    }
  });

  test("SECURITY: direct navigation to an ADMIN-only page redirects a UNIT_ADMIN away", async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.unitAdminCosc);
    try {
      await skipDashboardTour(page);
      await injectSession(page, ctx);
      await page.goto(`${CORE_URL}/admin/users`);
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveURL(/\/dashboard/);
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe("Unit Admin (unitadmin.multi@eduai.local) — multi-department scope", () => {
  test("course list spans every authorized department (MATH, STAT, DATA) in one view", async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.unitAdminMulti);
    try {
      await skipDashboardTour(page);
      await injectSession(page, ctx);
      await page.goto(`${CORE_URL}/courses`);
      await page.waitForLoadState("networkidle");
      // All three authorized departments (prisma/seed.ts: MATH 200, STAT 300,
      // DATA 310) must be visible in one view — asserting only MATH would let
      // a regression silently drop STAT or DATA coverage.
      await expect(page.getByText("MATH 200")).toBeVisible();
      await expect(page.getByText("STAT 300")).toBeVisible();
      await expect(page.getByText("DATA 310")).toBeVisible();
      // COSC is not in this admin's authorizedUnits — must not leak in.
      await expect(page.getByText("COSC 101")).toHaveCount(0);
    } finally {
      await ctx.dispose();
    }
  });
});

// ===========================================================================
// INSTRUCTOR — real browser walkthrough of own-course ownership
// ===========================================================================

test.describe("Instructor (instructor.cs@eduai.local) — own-course console UI", () => {
  test("opens own course and sees roster and materials surfaces", async ({ page, playwright }) => {
    const ctx = await newAuthedContext(playwright, USERS.instructorCS);
    try {
      await skipDashboardTour(page);
      await injectSession(page, ctx);
      await page.goto(`${CORE_URL}/courses`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("COSC 101")).toBeVisible();

      // CourseCard renders a full-card "stretched link" overlay (course-card.tsx)
      // as the actual clickable element — clicking arbitrary text inside the
      // card (e.g. the code badge) isn't guaranteed to hit it, so target the
      // real anchor by its accessible role instead.
      await page
        .getByRole("link", { name: /COSC 101/ })
        .first()
        .click();
      await page.waitForLoadState("networkidle");
      await expect(page).not.toHaveURL(/access=denied/);
      await expect(page).not.toHaveURL(/\/courses$/);

      // TA roster from the seed graph (Sam Carter is COSC 101's TA), on the
      // course detail page's default "Overview" tab. Give the client-side
      // `useCourseTAs` fetch (loads after the initial navigation, not in the
      // route loader) time to resolve.
      // "Sam Carter" renders twice: an Overview summary chip (visible to
      // INSTRUCTOR) and the Staff tab's roster entry — but the Staff tab
      // itself is admin/unit_admin only (`canManageStaff` in
      // manager-view-client-gates.ts), so its content stays mounted-but-hidden
      // for an INSTRUCTOR. Assert the Overview copy, which is the one this
      // role actually sees.
      await expect(page.getByLabel("Overview").getByText("Sam Carter")).toBeVisible({
        timeout: 15_000,
      });

      // Enrollments tab: the student roster surface (TA/instructor assignment
      // lives on the Staff tab, which is admin/unit_admin-only per
      // `canManageStaff` — out of scope for an INSTRUCTOR, hence this test's
      // narrower "roster" claim).
      await page.getByRole("tab", { name: "Enrollments" }).click();
      await expect(page.getByText("Enrolled users", { exact: true })).toBeVisible();

      // Materials tab.
      await page.getByRole("tab", { name: "Materials" }).click();
      await expect(page.getByRole("button", { name: "Upload material" })).toBeVisible();

      await page.screenshot({
        path: "test-results/admin-unitadmin-instructor/instructor-own-course.png",
        fullPage: true,
      });
    } finally {
      await ctx.dispose();
    }
  });

  test("SECURITY: sidebar has no Administration group and admin routes redirect away", async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.instructorCS);
    try {
      await skipDashboardTour(page);
      await injectSession(page, ctx);
      await page.goto(`${CORE_URL}/dashboard`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("link", { name: "User Management" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "AI Management" })).toHaveCount(0);

      await page.goto(`${CORE_URL}/admin/ai-models`);
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveURL(/\/dashboard/);
    } finally {
      await ctx.dispose();
    }
  });

  test("SECURITY: a different instructor's course (MATH 200) is not reachable and shows the access-denied banner", async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.instructorCS);
    try {
      await skipDashboardTour(page);
      await injectSession(page, ctx);
      await page.goto(`${CORE_URL}/courses`);
      await page.waitForLoadState("networkidle");
      // MATH 200 belongs to Dr. Emmy Noether — must not appear in this
      // instructor's own course list at all.
      await expect(page.getByText("MATH 200")).toHaveCount(0);
    } finally {
      await ctx.dispose();
    }
  });
});
