/**
 * AI Tutor UNIT_ADMIN — dashboard workflows (browser-driven).
 *
 * `/dashboard` is the shared landing page for every role; the UNIT_ADMIN
 * branch renders `DashboardUnitAdminView` (the shared `TeachingDashboard`).
 * Everything it shows is scoped server-side to the admin's `authorizedUnits`:
 * the "At a glance" stats come from `GET /api/me/dashboard-stats`, the course
 * grid and drafts from a bounded page of `GET /api/courses`.
 *
 * These tests assert the unit-admin *shape* of that page (which stats, which
 * sections, which card links) rather than exact counts — the E2E database is
 * shared, so the numbers move between runs.
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_API_URL, AI_TUTOR_URL } from "../../playwright.config";
import { signInThroughPage } from "../helpers/auth";
import { createUnitAdmin, type UnitAdminFixture } from "../helpers/at-unit-admin";

let ua: UnitAdminFixture;

/**
 * Exactly what the dashboard loader requests (`api.listCourses()` with no
 * params → page 1, `COURSE_LIST_PAGE_SIZE` = 200). `/api/courses` parses
 * pagination in *required* mode, so a bare call 400s with `PAGINATION_REQUIRED`
 * rather than falling back to a default page.
 */
const LOADER_COURSE_QUERY = "/api/courses?page=1&pageSize=200";

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

test.describe("UNIT_ADMIN dashboard", () => {
  test("At a glance reports the unit's course rollup", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    // The four stats defined by DashboardUnitAdminView — "Unit courses" is the
    // label no other role's dashboard uses.
    const glance = page.getByRole("region", { name: "At a glance" });
    await expect(glance.getByRole("heading", { name: "At a glance" })).toBeVisible();
    for (const label of ["Unit courses", "Published", "Unpublished", "Synced from EduAI"]) {
      await expect(glance.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test("the unit-courses grid links through to a course this admin owns", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    const unit = page.getByRole("region", { name: "Unit courses" });
    const link = unit.getByRole("link", { name: new RegExp(`^${ua.course.code} · `) });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", `/instructor/courses/${ua.course.atCourseId}`);
    await link.click();

    await page.waitForURL(`${AI_TUTOR_URL}/instructor/courses/${ua.course.atCourseId}`);
    await expect(page.getByText(ua.course.code).first()).toBeVisible();
  });

  test("each course card carries the unit admin's section shortcuts", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    const id = ua.course.atCourseId;
    const sections = page.getByRole("navigation", { name: `${ua.course.code} sections` });
    await expect(sections.getByRole("link", { name: "Content" })).toHaveAttribute(
      "href",
      `/instructor/courses/${id}`,
    );
    await expect(sections.getByRole("link", { name: "Analytics" })).toHaveAttribute(
      "href",
      `/instructor/courses/${id}?tab=analytics`,
    );
    await expect(sections.getByRole("link", { name: "Preview as student" })).toHaveAttribute(
      "href",
      `/student/courses/${id}`,
    );

    // The fixture course is a draft, so its ⋯ menu offers to publish it.
    await page.getByRole("button", { name: `${ua.course.code} actions` }).click();
    await expect(page.getByRole("menuitem", { name: "Publish course" })).toBeVisible();
  });

  test("All drafts navigates to the unit-scoped course list filtered to drafts", async ({
    page,
  }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    await page
      .getByRole("region", { name: "Needs attention" })
      .getByRole("link", { name: /All drafts/ })
      .click();
    await page.waitForURL(`${AI_TUTOR_URL}/instructor?status=draft`);
    await expect(page.getByText("Browse your courses and manage their content.")).toBeVisible();
  });

  /**
   * Where the fixture course sits in the panel's window, read from the very
   * call the loader makes.
   *
   * The panel renders at most five draft rows, drawn from one bounded page of a
   * database shared across runs — so a busy database, rather than a regression,
   * is what would otherwise fail these tests. Returns the index among drafts, or -1.
   */
  async function draftIndex(page: import("@playwright/test").Page): Promise<number> {
    const coursePage = await (
      await page.request.get(`${AI_TUTOR_API_URL}${LOADER_COURSE_QUERY}`)
    ).json();
    const drafts = (coursePage.data as Array<{ id: number; isPublished: boolean }>).filter(
      (c) => !c.isPublished,
    );
    return drafts.findIndex((c) => c.id === ua.course.atCourseId);
  }

  test("Needs attention lists draft courses and offers both publish and open", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    const attention = page.getByRole("region", { name: "Needs attention" });
    await expect(attention.getByRole("heading", { name: "Needs attention" })).toBeVisible();

    const index = await draftIndex(page);
    expect(index, "fixture course must be among the loaded drafts").toBeGreaterThanOrEqual(0);
    expect(index, "fixture course must be inside the 5-row Needs-attention window").toBeLessThan(5);

    // Two separate controls per draft, not one card doing double duty: the
    // publish action and the navigation are addressable independently, so a
    // click meant for one can never fire the other.
    await expect(
      attention.getByRole("button", { name: `Publish ${ua.course.code}` }),
    ).toBeVisible();

    // Opening the course is still one click away — it just isn't what the
    // publish control does.
    await attention.getByRole("link", { name: new RegExp(`^${ua.course.code}`) }).click();
    await page.waitForURL(`${AI_TUTOR_URL}/instructor/courses/${ua.course.atCourseId}`);
  });

  test("Publish it publishes the course, through Core", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    const index = await draftIndex(page);
    expect(index, "fixture course must be among the loaded drafts").toBeGreaterThanOrEqual(0);
    expect(index, "fixture course must be inside the 5-row Needs-attention window").toBeLessThan(5);

    try {
      await page.getByRole("button", { name: `Publish ${ua.course.code}` }).click();

      // Confirmed by name first, and the confirm is explicit that the publish
      // does not cascade — modules and lessons stay hidden.
      const confirm = page.getByRole("alertdialog");
      await expect(confirm).toContainText(ua.course.name);
      await expect(confirm).toContainText("modules and lessons stay hidden");
      await confirm.getByRole("button", { name: "Publish", exact: true }).click();

      // The row leaves the drafts panel…
      await expect(page.getByRole("button", { name: `Publish ${ua.course.code}` })).toHaveCount(0, {
        timeout: 15_000,
      });

      // …because the write really landed. Course publish state is owned by Core,
      // so AI Tutor's own read is the round trip that proves it, not the
      // optimistic UI above.
      const after = await (
        await page.request.get(`${AI_TUTOR_API_URL}/api/courses/${ua.course.atCourseId}`)
      ).json();
      expect(after.isPublished).toBe(true);
    } finally {
      // Restore the fixture: this file's other tests read the same shared course,
      // and a retry would otherwise start with nothing left to publish.
      await ua.instrCtx.patch(`${AI_TUTOR_API_URL}/api/courses/${ua.course.atCourseId}/unpublish`);
    }
  });

  test("the bounded course panel discloses exactly when it is not the full set", async ({
    page,
  }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    // #1208: the panels render one bounded page while the tiles count the whole
    // set, so a bounded page has to say so instead of implying completeness.
    //
    // The expectation is derived from the very call the loader makes
    // (`api.listCourses()` with no params), rather than accepting whichever of
    // several affordances happens to be on screen.
    const coursePage = await (
      await page.request.get(`${AI_TUTOR_API_URL}${LOADER_COURSE_QUERY}`)
    ).json();
    const shown: number = coursePage.data.length;
    const total: number = coursePage.total;

    const notice = page.getByTestId("truncated-list-notice");
    const allCourses = page.getByRole("link", { name: /^All [\d,]+ courses$/ });
    if (total > shown) {
      await expect(notice.first()).toBeVisible();
      await expect(notice.first()).toContainText(
        `Showing ${shown.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} courses`,
      );
      await expect(allCourses).toHaveAttribute("href", "/instructor");
    } else {
      // Nothing was withheld — the notice must not cry wolf.
      await expect(notice).toHaveCount(0);
      await expect(allCourses).toHaveCount(0);
    }
  });

  test("the dashboard rollup is scoped to the admin's units, not the platform", async ({
    page,
  }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    // `page.request` shares the browser context's cookies, so this is the same
    // authenticated call the tiles above are rendered from.
    const stats = await (
      await page.request.get(`${AI_TUTOR_API_URL}/api/me/dashboard-stats`)
    ).json();
    expect(stats.role).toBe("UNIT_ADMIN");
    expect(stats.totalCourses).toEqual(expect.any(Number));

    // The out-of-unit course exists but is not reachable at all, which is what
    // keeps it out of every count above (see unit-admin-access-boundaries).
    const denied = await page.request.get(
      `${AI_TUTOR_API_URL}/api/courses/${ua.outOfUnit.atCourseId}`,
    );
    expect(denied.status()).toBe(403);
  });
});
