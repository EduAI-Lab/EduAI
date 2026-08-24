/**
 * AI Tutor INSTRUCTOR — submissions and grading workflows (browser-driven).
 *
 * `canGradeSubmissions` admits the course-staff set, so an instructor can
 * override the auto-grade on any attempt in a course they teach. This is the
 * one place in AI Tutor where an instructor writes to a *student's* record
 * rather than to their own content, so the tests check the write really lands
 * rather than trusting the dialog closing.
 *
 * Getting a submission to exist takes the whole spine: a published course,
 * module and lesson, an activity, and an enrolled student who answered it —
 * `POST /questions/:id/answer` gates on Core's live publish state and on a
 * live enrollment, so none of it can be short-circuited.
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_API_URL, AI_TUTOR_URL } from "../../playwright.config";
import { signInThroughPage } from "../helpers/auth";
import {
  createTeachingInstructor,
  seedInstructorSpine,
  seedInstructorSubmission,
  type InstructorFixture,
} from "../helpers/at-instructor";
import { gotoAiTutor, openTab } from "../helpers/at-ui";

let fx: InstructorFixture;
let spine: Awaited<ReturnType<typeof seedInstructorSpine>>;
let student: Awaited<ReturnType<typeof seedInstructorSubmission>>;

test.beforeAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  try {
    fx = await createTeachingInstructor(playwright, ctx, {
      publishCourse: true,
      seedTopic: true,
    });
    spine = await seedInstructorSpine(ctx, fx, { publish: true });
    // The default answer is the *wrong* choice, so the attempt arrives marked
    // incorrect and there is a verdict worth overriding.
    student = await seedInstructorSubmission(playwright, fx, spine.activityId);
  } finally {
    await ctx.dispose();
  }
});

test.afterAll(async () => {
  await fx?.dispose();
});

/** Open the course's Submissions tab. */
async function openSubmissions(page: import("@playwright/test").Page) {
  await gotoAiTutor(page, `/instructor/courses/${fx.course.atCourseId}`);
  await openTab(page, "Submissions");
  // Gate on a stat tile rather than the card title: "Submissions" is a
  // `CardTitle`, which is not a heading element, and the word also appears as
  // the tab label — so neither is a usable "the panel has painted" signal.
  await expect(page.getByText("Pass rate", { exact: true })).toBeVisible({ timeout: 30_000 });
}

test.describe("INSTRUCTOR submissions and grading", () => {
  test("the submissions tab summarises the course's attempts", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await openSubmissions(page);

    // Four stat tiles over the whole course, then the attempt list itself.
    for (const label of ["Needs grading", "Correct", "Pass rate"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText(student.studentName).first()).toBeVisible();
    await expect(page.getByText(spine.question).first()).toBeVisible();
  });

  test("filters the attempt list by result", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await openSubmissions(page);

    // `SegmentedControl` renders `role="radiogroup"` with `role="radio"` items.
    const filter = page.getByRole("radiogroup", { name: "Filter submissions by result" });
    await expect(filter).toBeVisible();

    // The seeded attempt is incorrect, so "Correct" must exclude it — and say
    // that it filtered rather than reading as "there are no submissions".
    // `exact` matters: "Correct" is a substring of "Incorrect".
    await filter.getByRole("radio", { name: "Correct", exact: true }).click();
    await expect(page.getByText("No submissions match this filter.")).toBeVisible({
      timeout: 15_000,
    });

    await filter.getByRole("radio", { name: "Incorrect", exact: true }).click();
    await expect(page.getByText(student.studentName).first()).toBeVisible({ timeout: 15_000 });
  });

  test("searches attempts by student or activity", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await openSubmissions(page);

    const box = page.getByRole("textbox", { name: "Search submissions" });
    await box.fill("zzz-no-student-matches-zzz");
    await expect(page.getByText("No submissions match this filter.")).toBeVisible({
      timeout: 15_000,
    });

    await box.fill(student.studentName);
    await expect(page.getByText(student.studentName).first()).toBeVisible({ timeout: 15_000 });
  });

  test("switches between grid and extended views", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await openSubmissions(page);

    const grid = page.getByRole("button", { name: "Grid view" });
    const extended = page.getByRole("button", { name: "Extended view" });
    await expect(grid).toHaveAttribute("aria-pressed", "true");

    await extended.click();
    await expect(extended).toHaveAttribute("aria-pressed", "true");
    await expect(grid).toHaveAttribute("aria-pressed", "false");
    // The attempt is still listed — the toggle changes the layout, not the set.
    await expect(page.getByText(student.studentName).first()).toBeVisible();
  });

  test("opens an attempt and shows what the student actually answered", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await openSubmissions(page);

    await page.getByRole("button", { name: "Grade" }).last().click();
    const dialog = page.getByRole("dialog");

    // Everything needed to judge the attempt without leaving the dialog: who,
    // which question, what they picked, and what the auto-grade decided.
    // The section labels are uppercased by CSS, so match the DOM text.
    await expect(dialog).toContainText(student.studentName);
    await expect(dialog).toContainText("Question");
    await expect(dialog).toContainText(spine.question);
    await expect(dialog).toContainText("Submitted answer");
    await expect(dialog).toContainText("Incorrect");
  });

  test("overrides the auto-grade on a student's attempt", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await openSubmissions(page);

    await page.getByRole("button", { name: "Grade" }).last().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Override grade");

    // The result is chosen explicitly — "Not graded" is a real option, so an
    // instructor can withdraw a verdict as well as replace one.
    await dialog.getByRole("combobox").click();
    // `exact`: the same list offers "Incorrect", which contains "Correct".
    await page.getByRole("option", { name: "Correct", exact: true }).click();
    await dialog.getByRole("spinbutton").fill("1");
    await dialog.getByRole("button", { name: "Save grade" }).click();

    await expect(dialog).toHaveCount(0, { timeout: 30_000 });

    // The override really lands on the student's record. This is the assertion
    // that matters: the dialog closing only proves the dialog closed.
    await expect
      .poll(
        async () => {
          const res = await page.request.get(
            `${AI_TUTOR_API_URL}/api/activities/${spine.activityId}/submissions`,
          );
          const body = await res.json();
          const rows = Array.isArray(body) ? body : (body.data ?? []);
          return rows[0]?.isCorrect;
        },
        { timeout: 30_000, message: "the grade override was never persisted" },
      )
      .toBe(true);
  });

  test("the graded attempt is reflected back in the course rollup", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await openSubmissions(page);

    // The tiles are computed over the course's whole submission set, read from
    // the *course* endpoint rather than the activity one the override was
    // polled back from — so this proves the override propagated to the rollup's
    // own source, not merely that the row it edited changed.
    const stats = await (
      await page.request.get(
        `${AI_TUTOR_API_URL}/api/courses/${fx.course.atCourseId}/submissions?page=1&pageSize=200`,
      )
    ).json();
    // The course endpoint answers with a bare array; `.data` is the shape the
    // paginated endpoints use, kept as a fallback rather than assumed away.
    const rows: Array<{ isCorrect?: boolean; studentName?: string | null }> = Array.isArray(stats)
      ? stats
      : (stats.data ?? []);
    const seeded = rows.find((row) => row.studentName === student.studentName);
    expect(seeded, "the seeded attempt must be in the course-wide submission set").toBeTruthy();
    // Seeded as the wrong choice, overridden to Correct in the test above.
    expect(seeded!.isCorrect, "the override is reflected course-wide").toBe(true);

    // And the tab renders that rollup rather than a stale one: with the only
    // attempt now correct, the "Correct" filter must include it.
    const filter = page.getByRole("radiogroup", { name: "Filter submissions by result" });
    await filter.getByRole("radio", { name: "Correct", exact: true }).click();
    await expect(page.getByText(student.studentName).first()).toBeVisible({ timeout: 15_000 });
  });

  test("reads the course's per-activity and per-student analytics", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, `/instructor/courses/${fx.course.atCourseId}`);
    await openTab(page, "Analytics");

    // `CardTitle` is a styled div, not a heading element, so these are matched
    // as text.
    await expect(page.getByText("Activity analytics")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Student metrics")).toBeVisible();
    await expect(page.getByText("Per-student activity performance.")).toBeVisible();
    // Per-student rows are staff-only data; the enrolled student appears by name.
    await expect(page.getByText(student.studentName).first()).toBeVisible();
  });

  test("reads and filters the course's feedback", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, `/instructor/courses/${fx.course.atCourseId}`);
    await openTab(page, "Feedback");

    await expect(page.getByRole("heading", { name: "Feedback" })).toBeVisible({ timeout: 30_000 });

    // A non-numeric Activity ID is refused client-side, before any request, so
    // a typo never costs a round trip or blanks the table.
    const activityField = page.getByLabel(/Activity/i).first();
    await activityField.fill("not-a-number");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByText("Activity ID must be a number.")).toBeVisible();

    await page.getByRole("button", { name: "Clear" }).click();
    // Clear empties both fields…
    await expect(activityField).toHaveValue("");

    // …and takes the validation message with them, so the panel stops
    // describing an input the reader can see is empty. `clearFilters` used to
    // reset the fields and the applied filters but never `setError(null)`, and
    // with no applied filter to change, no reload followed to clear it either.
    await expect(page.getByText("Activity ID must be a number.")).toHaveCount(0);
  });
});
