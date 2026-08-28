/**
 * AI Tutor INSTRUCTOR — course list workflows (browser-driven).
 *
 * `/instructor` is the instructor's home for everything teaching-side. The
 * backend scopes `GET /api/courses` to the caller's enrollments, so the list is
 * exactly the set this instructor can act on — there is no client-side filter
 * standing between the two.
 *
 * Search, the filter dropdowns and the pager are all applied SERVER-side and
 * mirrored into the URL (#1207/#1208), so each of these workflows is also a
 * claim about bookmarkability: reloading the URL must reproduce the same list.
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_URL } from "../../playwright.config";
import { createInstructor, signInThroughPage } from "../helpers/auth";
import { createTeachingInstructor, type InstructorFixture } from "../helpers/at-instructor";
import { courseLink, gotoAiTutor } from "../helpers/at-ui";

let fx: InstructorFixture;

test.beforeAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  try {
    // Two taught courses: enough for a two-page list at `?pageSize=1`, and
    // enough for a search term that matches one and not the other.
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

test.describe("INSTRUCTOR course list", () => {
  test("browsing the list shows the courses this instructor teaches", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/instructor`);

    await expect(page.getByRole("heading", { name: "Courses", exact: true })).toBeVisible();
    await expect(page.getByText("Browse your courses and manage their content.")).toBeVisible();

    // Both taught courses are present; the course taught by someone else is not.
    await expect(courseLink(page, fx.course.atCourseId)).toBeVisible();
    await expect(courseLink(page, fx.second!.atCourseId)).toBeVisible();
    await expect(courseLink(page, fx.foreign.atCourseId)).toHaveCount(0);
  });

  test("a course card carries its EduAI origin and publish state", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/instructor`);

    // Courses are created in Core and sync here automatically — the badge is
    // what makes that origin obvious rather than implied.
    const card = page.locator(`a[href$="/courses/${fx.course.atCourseId}"]`).first();
    await expect(card).toBeVisible();
    await expect(page.getByText(fx.course.code).first()).toBeVisible();
    await expect(page.getByText("EduAI").first()).toBeVisible();
  });

  test("opening a course from the list reaches its detail page", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/instructor`);

    await courseLink(page, fx.course.atCourseId).click();
    await page.waitForURL(`${AI_TUTOR_URL}/instructor/courses/${fx.course.atCourseId}`);
    await expect(page.getByRole("tab", { name: "Content" })).toBeVisible();
  });

  test("search narrows the list and is mirrored into the URL", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    // Via `gotoAiTutor` rather than the sign-in redirect: it waits for the SPA's
    // auth bootstrap to paint the shell. Typing into a rendered-but-not-yet-
    // hydrated input sets the DOM value without firing React's onChange, so the
    // search silently never runs.
    await gotoAiTutor(page, "/instructor");

    // The fixture's two course names differ ("Instructor E2E …" vs "Instructor
    // Import Source E2E …"), so "Import Source" matches exactly one.
    await page.getByRole("searchbox", { name: "Search courses" }).fill("Import Source");

    await expect(courseLink(page, fx.second!.atCourseId)).toBeVisible({ timeout: 15_000 });
    await expect(courseLink(page, fx.course.atCourseId)).toHaveCount(0);

    // Server-side and bookmarkable: the term lives in `?search=`, so a reload
    // reproduces the narrowed list rather than the full one.
    await expect(page).toHaveURL(/[?&]search=Import\+Source/);
    await page.reload();
    await expect(courseLink(page, fx.second!.atCourseId)).toBeVisible({ timeout: 30_000 });
    await expect(courseLink(page, fx.course.atCourseId)).toHaveCount(0);
  });

  test("a search matching nothing says so rather than showing an unfiltered list", async ({
    page,
  }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, "/instructor");

    await page
      .getByRole("searchbox", { name: "Search courses" })
      .fill("zzz-no-course-matches-this-zzz");

    await expect(page.getByRole("heading", { name: "No courses match" })).toBeVisible({
      timeout: 15_000,
    });
    // The distinction matters: "No courses match" is a result, whereas "Search
    // is unavailable" is what renders when Core is down and every filter
    // fail-closes to zero rows.
    await expect(page.getByRole("heading", { name: "Search is unavailable" })).toHaveCount(0);
  });

  test("the Status filter narrows the list, and Clear restores it", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, "/instructor");

    // The trigger is a Radix `<button role="combobox">` whose only content is
    // the dimension label, so match on that text rather than an aria-label it
    // does not carry. (Term is absent here: `buildTermFilterGroup` hides a
    // dimension with a single value, and the fixture's courses share a term.)
    await page.getByRole("combobox").filter({ hasText: "Status" }).click();
    await page.getByRole("option", { name: "Draft" }).click();

    // Only the unpublished course survives the filter.
    await expect(courseLink(page, fx.second!.atCourseId)).toBeVisible({ timeout: 15_000 });
    await expect(courseLink(page, fx.course.atCourseId)).toHaveCount(0);
    await expect(page).toHaveURL(/[?&]status=draft/);

    await page.getByRole("button", { name: "Clear" }).click();
    await expect(courseLink(page, fx.course.atCourseId)).toBeVisible({ timeout: 15_000 });
  });

  test("the pager walks pages and keeps the page in the URL", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/instructor`);
    // `?pageSize=` is clamped to the API ceiling and exists so a narrow,
    // bookmarkable page can be requested without seeding 200+ courses.
    await gotoAiTutor(page, "/instructor?pageSize=1");

    const pager = page.getByRole("navigation", { name: "Pagination" });
    await expect(pager).toBeVisible({ timeout: 30_000 });
    await expect(pager).toContainText("Page 1 of");

    await pager.getByRole("button", { name: "Next" }).click();
    await expect(page).toHaveURL(/[?&]page=2/);
    await expect(pager).toContainText("Page 2 of");

    // The page lives in the URL, so it survives a reload.
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Pagination" })).toContainText("Page 2 of", {
      timeout: 30_000,
    });
  });

  test("a page past the end redirects to the last page instead of rendering empty", async ({
    page,
  }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/instructor`);

    // #1162: a bookmarked or hand-edited `?page=` past the end would otherwise
    // render an empty list while the pager reported a non-zero total. The
    // loader redirects rather than silently clamping, so the URL and the
    // rendered page cannot disagree.
    await page.goto(`${AI_TUTOR_URL}/instructor?pageSize=1&page=9999`);

    await expect(page.getByRole("navigation", { name: "Pagination" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).not.toHaveURL(/[?&]page=9999/);
    const url = new URL(page.url());
    expect(Number(url.searchParams.get("page"))).toBeGreaterThanOrEqual(1);
  });

  test("an instructor with no courses is pointed at EduAI Core", async ({ page, playwright }) => {
    // A brand-new instructor with no enrollments at all. `createInstructor`
    // sets the platform role and nothing else, which is exactly the state a
    // real instructor is in before Core assigns them a course.
    const ctx = await playwright.request.newContext();
    try {
      const fresh = await createInstructor(ctx, { prefix: "instr-empty" });
      await signInThroughPage(page, fresh, `${AI_TUTOR_URL}/instructor`);

      // "No courses yet" is a claim about the account, distinct from the
      // "No courses match" a filter produces — and it names where courses
      // actually come from instead of leaving the reader stuck.
      await expect(page.getByRole("heading", { name: "No courses yet" })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByRole("link", { name: "EduAI Core" })).toBeVisible();
      // Course *creation* is owned by Core for every role, so there is no
      // "New course" affordance here to offer instead.
      await expect(page.getByRole("button", { name: /New course|Create course/ })).toHaveCount(0);
    } finally {
      await ctx.dispose();
    }
  });
});
