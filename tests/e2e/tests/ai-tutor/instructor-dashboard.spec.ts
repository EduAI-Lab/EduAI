/**
 * AI Tutor INSTRUCTOR — dashboard workflows (browser-driven).
 *
 * `/dashboard` is the shared landing page for every role; the INSTRUCTOR branch
 * renders `DashboardInstructorView`. Everything on it is scoped server-side to
 * the courses this user is enrolled on as INSTRUCTOR: the stat tiles and donut
 * from `GET /api/me/dashboard-stats`, the course panels from a bounded page of
 * `GET /api/courses`.
 *
 * These tests assert the instructor *shape* of the page (which tiles, which
 * quick actions, which panel) rather than exact counts — the E2E database is
 * shared, so the numbers move between runs.
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_API_URL, AI_TUTOR_URL } from "../../playwright.config";
import { signInThroughPage } from "../helpers/auth";
import { createTeachingInstructor, type InstructorFixture } from "../helpers/at-instructor";
import { courseLink } from "../helpers/at-ui";

let fx: InstructorFixture;

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
    // Two taught courses, one published and one draft, so both the donut and
    // the "Needs attention" panel have something real to render.
    fx = await createTeachingInstructor(playwright, ctx, {
      publishCourse: true,
      secondCourse: true,
    });
  } finally {
    await ctx.dispose();
  }
});

test.afterAll(async () => {
  await fx?.dispose();
});

/**
 * Where the second (draft) course sits among the drafts the panel loaded, read
 * from the very call the loader makes.
 *
 * The panel renders the newest draft as a hero plus at most four more rows, all
 * drawn from one bounded page of a database shared across runs — so a busy
 * database, rather than a regression, is what would otherwise fail these tests.
 * Returns the index among drafts, or -1.
 */
async function draftIndex(page: import("@playwright/test").Page): Promise<number> {
  const coursePage = await (
    await page.request.get(`${AI_TUTOR_API_URL}${LOADER_COURSE_QUERY}`)
  ).json();
  const drafts = (coursePage.data as Array<{ id: number; isPublished: boolean }>).filter(
    (c) => !c.isPublished,
  );
  return drafts.findIndex((c) => c.id === fx.second!.atCourseId);
}

test.describe("INSTRUCTOR dashboard", () => {
  test("the stat grid reports the instructor's own course rollup", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // The four tiles defined by DashboardInstructorView. "Courses teaching" is
    // the label no other role's dashboard uses — a unit admin gets "Unit
    // courses" from the same grid position.
    for (const label of ["Courses teaching", "Published", "Drafts", "Synced from EduAI"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  test("the publish-status donut is rendered from the same rollup", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    await expect(page.getByRole("heading", { name: "Publish status" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Draft courses" })).toBeVisible();
    await expect(page.getByText("Courses", { exact: true }).first()).toBeVisible();
  });

  test("the your-courses panel links through to a course this instructor teaches", async ({
    page,
  }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    await expect(page.getByRole("heading", { name: "Your courses" })).toBeVisible();
    const link = courseLink(page, fx.course.atCourseId);
    await expect(link).toBeVisible();
    await link.click();

    await page.waitForURL(`${AI_TUTOR_URL}/instructor/courses/${fx.course.atCourseId}`);
    await expect(page.getByText(fx.course.code).first()).toBeVisible();
  });

  test("quick actions offer the instructor's three entry points", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    await expect(page.getByRole("heading", { name: "Quick actions" })).toBeVisible();
    // The copy is instructor-specific ("everything you teach"), not the unit
    // admin's "every course in your authorized units".
    await expect(page.getByText("See everything you teach.")).toBeVisible();
    await expect(page.getByText("Manage your AI providers and accessibility.")).toBeVisible();
    // "Publish content" points at the first draft course, or the list when
    // there is none — either way it is a link, never a publish action here.
    await expect(page.getByText("Publish content")).toBeVisible();
  });

  test("View courses navigates to the taught-course list", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    await page.getByRole("link", { name: /View courses/ }).click();
    await page.waitForURL(`${AI_TUTOR_URL}/instructor`);
    await expect(page.getByText("Browse your courses and manage their content.")).toBeVisible();
  });

  test("Needs attention lists draft courses and offers both publish and open", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const draft = fx.second!;

    await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();

    const index = await draftIndex(page);
    expect(index, "fixture draft must be among the loaded drafts").toBeGreaterThanOrEqual(0);
    expect(index, "fixture draft must be inside the 5-row Needs-attention window").toBeLessThan(5);

    // Two separate controls per draft, not one card doing double duty: the
    // publish action and the navigation are addressable independently, so a
    // click meant for one can never fire the other.
    await expect(page.getByRole("button", { name: `Publish ${draft.code}` })).toBeVisible();

    await page.getByRole("button", { name: new RegExp(`^Open ${draft.code}`) }).click();
    await page.waitForURL(`${AI_TUTOR_URL}/instructor/courses/${draft.atCourseId}`);
  });

  test("Publish it publishes the draft course, through Core", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const draft = fx.second!;

    const index = await draftIndex(page);
    expect(index, "fixture draft must be among the loaded drafts").toBeGreaterThanOrEqual(0);
    expect(index, "fixture draft must be inside the 5-row Needs-attention window").toBeLessThan(5);

    try {
      await page.getByRole("button", { name: `Publish ${draft.code}` }).click();

      // Confirmed by name first, and the confirm is explicit that the publish
      // does not cascade — modules and lessons stay hidden.
      const confirm = page.getByRole("alertdialog");
      await expect(confirm).toContainText(draft.name);
      await expect(confirm).toContainText("modules and lessons stay hidden");
      await confirm.getByRole("button", { name: "Publish", exact: true }).click();

      // The row leaves the drafts panel…
      await expect(page.getByRole("button", { name: `Publish ${draft.code}` })).toHaveCount(0, {
        timeout: 15_000,
      });

      // …because the write really landed. Course publish state is owned by
      // Core, so AI Tutor's own read is the round trip that proves it, not the
      // optimistic UI above.
      //
      // Polled rather than read once: the panel hides the row as soon as its
      // own `PATCH` resolves, but AI Tutor serves `isPublished` from a Core
      // catalog read that can still be answering from the pre-publish fetch for
      // a moment. That gap is the very thing `corePublishStale` exists to warn
      // about — so the assertion stays strict about the outcome and only allows
      // time for it, rather than accepting "published according to us".
      await expect
        .poll(
          async () => {
            const res = await page.request.get(
              `${AI_TUTOR_API_URL}/api/courses/${draft.atCourseId}`,
            );
            return (await res.json()).isPublished;
          },
          { timeout: 30_000, message: "Core never confirmed the course as published" },
        )
        .toBe(true);
    } finally {
      // Restore the fixture: this file's other tests read the same shared
      // draft, and a retry would otherwise start with nothing left to publish.
      await page.request.patch(`${AI_TUTOR_API_URL}/api/courses/${draft.atCourseId}/unpublish`);
    }
  });

  test("the bounded course panel discloses exactly when it is not the full set", async ({
    page,
  }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // #1208: the panels render one bounded page while the tiles count the whole
    // set, so a bounded page has to say so instead of implying completeness.
    //
    // The expectation is derived from the very call the loader makes, rather
    // than accepting whichever affordance happens to be on screen: `Browse all`
    // is rendered unconditionally by DashboardView, so asserting on it would
    // pass whether or not the disclosure works.
    const coursePage = await (
      await page.request.get(`${AI_TUTOR_API_URL}${LOADER_COURSE_QUERY}`)
    ).json();
    const shown: number = coursePage.data.length;
    const total: number = coursePage.total;

    const notice = page.getByTestId("truncated-list-notice");
    if (total > shown) {
      await expect(notice.first()).toBeVisible();
      await expect(notice.first()).toContainText(
        `Showing ${shown.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} courses`,
      );
    } else {
      // Nothing was withheld — the notice must not cry wolf.
      await expect(notice).toHaveCount(0);
    }
  });

  test("the dashboard rollup is scoped to what this instructor teaches", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // `page.request` shares the browser context's cookies, so this is the same
    // authenticated call the tiles above are rendered from.
    const stats = await (
      await page.request.get(`${AI_TUTOR_API_URL}/api/me/dashboard-stats`)
    ).json();
    expect(stats.role).toBe("INSTRUCTOR");
    // For an instructor the platform-wide and personal counts are the same set:
    // scope *is* the enrollment list, so there is no wider total to compare to.
    expect(stats.yourCourses).toBe(stats.totalCourses);
    expect(typeof stats.enrolledStudents).toBe("number");

    // A course taught by someone else exists but is not reachable at all, which
    // is what keeps it out of every count above (see
    // instructor-access-boundaries.spec.ts).
    const denied = await page.request.get(
      `${AI_TUTOR_API_URL}/api/courses/${fx.foreign.atCourseId}`,
    );
    expect(denied.status()).toBe(403);
  });
});
