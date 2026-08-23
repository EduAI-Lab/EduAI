/**
 * AI Tutor INSTRUCTOR — course detail workflows (browser-driven).
 *
 * The course page is one hero plus four tabs. Which tabs exist is decided by
 * `getCourseDetailTabs`, and an instructor gets all four — Content, Submissions,
 * Feedback and Analytics — because `canViewCourseAnalytics` and
 * `canViewCourseFeedback` both admit the `instructor` access level.
 *
 * What is *not* here matters as much: course publish state is a read-only badge
 * (the publish action lives only on the dashboard's drafts panel, so there is
 * one entry point rather than two), and a Core-sourced course exposes no manual
 * topic control because AI Tutor pulls its topics from Core on every read.
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_URL } from "../../playwright.config";
import { signInThroughPage } from "../helpers/auth";
import {
  createTeachingInstructor,
  seedInstructorSpine,
  type InstructorFixture,
} from "../helpers/at-instructor";
import { gotoAiTutor, openTab } from "../helpers/at-ui";

let fx: InstructorFixture;
let spine: Awaited<ReturnType<typeof seedInstructorSpine>>;

test.beforeAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  try {
    fx = await createTeachingInstructor(playwright, ctx, {
      publishCourse: true,
      secondCourse: true,
      seedTopic: true,
    });
    spine = await seedInstructorSpine(ctx, fx, { publish: true });
  } finally {
    await ctx.dispose();
  }
});

test.afterAll(async () => {
  await fx?.dispose();
});

test.describe("INSTRUCTOR course detail", () => {
  test("the course hero names the course, its state and its topics", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, `/instructor/courses/${fx.course.atCourseId}`);

    await expect(page.getByText(fx.course.code).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: fx.course.name })).toBeVisible();
    // Publish state is a read-only badge here; the action lives on the
    // dashboard's drafts panel so there is exactly one place to publish from.
    await expect(page.getByText("Published").first()).toBeVisible();
    // Topics come from Core through the sync-on-read seam and render as chips.
    await expect(page.getByText(fx.seededTopic!).first()).toBeVisible();
  });

  test("a Core-sourced course offers no manual topic control", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, `/instructor/courses/${fx.course.atCourseId}`);

    // Every offering is a Core anchor row (#1072), and Core owns its topics —
    // AI Tutor pulls them on every `GET /topics`. Offering an "Add topic"
    // button here would let an instructor create a topic that the next Core
    // sync could contradict, so `CourseTopicsHeroAction` renders nothing for a
    // linked course even though `canManageTopics` is true for this role.
    await expect(page.getByText(fx.seededTopic!).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /Add topic/i })).toHaveCount(0);
  });

  test("all four course tabs are available to an instructor", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, `/instructor/courses/${fx.course.atCourseId}`);

    const tabs = await page.getByRole("tab").allInnerTexts();
    expect(tabs.map((t) => t.trim())).toEqual(["Content", "Submissions", "Feedback", "Analytics"]);
  });

  test("the Content tab lists the course's modules", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, `/instructor/courses/${fx.course.atCourseId}`);

    await expect(page.getByRole("heading", { name: "Modules" })).toBeVisible();
    await expect(page.getByText(spine.moduleTitle).first()).toBeVisible({ timeout: 30_000 });
  });

  test("drilling down reaches the module and then the lesson", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, `/instructor/courses/${fx.course.atCourseId}`);

    await page.getByText(spine.moduleTitle).first().click();
    await page.waitForURL(`${AI_TUTOR_URL}/instructor/module/${spine.moduleId}`);
    await expect(page.getByText(spine.lessonTitle).first()).toBeVisible({ timeout: 30_000 });

    await page.getByText(spine.lessonTitle).first().click();
    await page.waitForURL(`${AI_TUTOR_URL}/instructor/lesson/${spine.lessonId}`);
    await expect(page.getByRole("heading", { name: "Activities" })).toBeVisible();
  });

  test("the breadcrumb course switcher moves between taught courses", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, `/instructor/courses/${fx.course.atCourseId}`);

    // The course crumb doubles as a switcher, so changing course does not mean
    // going back to the list first. The crumb renders two controls: the course
    // name (a label) and a separate "Switch course" trigger — the trigger is
    // the one that opens the picker.
    await page.getByRole("button", { name: "Switch course" }).click();
    // A dropdown menu with a search box, not a listbox — its rows are
    // `menuitem`s under a "Your courses" group, plus an "All courses" escape.
    const menu = page.getByRole("menu", { name: "Switch course" });
    const target = menu.getByRole("menuitem", { name: fx.second!.name });
    await expect(target).toBeVisible({ timeout: 15_000 });
    // Scoped to what this instructor teaches — a course taught by someone else
    // is not switchable to.
    await expect(menu.getByRole("menuitem", { name: fx.foreign.name })).toHaveCount(0);
    await target.click();

    await page.waitForURL(`${AI_TUTOR_URL}/instructor/courses/${fx.second!.atCourseId}`);
    await expect(page.getByText(fx.second!.code).first()).toBeVisible();
  });

  test("the Submissions tab is reachable and reports the grading rollup", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, `/instructor/courses/${fx.course.atCourseId}`);

    await openTab(page, "Submissions");
    // Gated on a stat tile: the panel's "Submissions" title is a `CardTitle`,
    // which is not a heading element, and the same word is the tab label — so
    // neither is a usable "the panel has painted" signal. (This assertion used
    // to `.or()` on a "Submissions" heading, a branch that could never match.)
    await expect(page.getByText("Pass rate", { exact: true })).toBeVisible({ timeout: 30_000 });
    // With no attempts yet the panel says so rather than rendering an empty
    // table that reads as a loading failure.
    await expect(page.getByText("No submissions yet.")).toBeVisible();
  });

  test("the Feedback tab is reachable", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, `/instructor/courses/${fx.course.atCourseId}`);

    await openTab(page, "Feedback");
    await expect(page.getByRole("heading", { name: "Feedback" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Apply filters" })).toBeVisible();
  });

  test("the Analytics tab is reachable and is honest about having no data", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, `/instructor/courses/${fx.course.atCourseId}`);

    await openTab(page, "Analytics");
    await expect(page.getByRole("heading", { name: "Overall accuracy" })).toBeVisible({
      timeout: 30_000,
    });

    // This course has no attempts, and each panel says so in its own words
    // rather than rendering an empty table or a fabricated zero. (The populated
    // shape — the difficulty donut and both tables — is covered in
    // instructor-grading.spec.ts, which seeds a real submission.)
    await expect(page.getByText("No graded submissions yet.")).toBeVisible();
    await expect(page.getByText("No analytics recorded yet.")).toBeVisible();
    await expect(page.getByText("No metrics recorded yet.")).toBeVisible();
  });

  test("a module page past the end redirects instead of rendering empty", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // #1207/#1162: the module list carries `?page=` so it survives reload, and
    // a bookmarked page past the end redirects rather than silently clamping —
    // a clamp would render page 1 while the address bar still claimed page 40.
    // Unlike the course list this route has no `?pageSize=` override, so the
    // out-of-range case is the pager behaviour reachable without seeding a
    // page's worth of modules.
    await page.goto(`${AI_TUTOR_URL}/instructor/courses/${fx.course.atCourseId}?page=9999`);

    await expect(page.getByRole("heading", { name: "Modules" })).toBeVisible({ timeout: 30_000 });
    await expect(page).not.toHaveURL(/[?&]page=9999/);
    await expect(page.getByText(spine.moduleTitle).first()).toBeVisible();
  });
});
