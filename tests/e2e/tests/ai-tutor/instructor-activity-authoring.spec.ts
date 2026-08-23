/**
 * AI Tutor INSTRUCTOR — activity authoring workflows (browser-driven).
 *
 * Activities are the leaves of the content tree and the only place a student
 * ever meets the AI, so this is the screen where an instructor's authoring and
 * the tutor's behaviour actually meet. The form is gated on `canManageContent`,
 * which admits `instructor`.
 *
 * A course with no topics disables the main-topic picker for *everyone*
 * (`AddActivityPanel` disables on `topics.length === 0`), so the fixture seeds a
 * topic in Core before the import — otherwise "the picker is disabled" would be
 * evidence of nothing.
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_API_URL, AI_TUTOR_URL } from "../../playwright.config";
import { signInThroughPage } from "../helpers/auth";
import {
  createTeachingInstructor,
  seedInstructorSpine,
  type InstructorFixture,
} from "../helpers/at-instructor";
import { gotoAiTutor } from "../helpers/at-ui";

let fx: InstructorFixture;
let spine: Awaited<ReturnType<typeof seedInstructorSpine>>;

test.beforeAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  try {
    fx = await createTeachingInstructor(playwright, ctx, {
      publishCourse: true,
      seedTopic: true,
    });
    spine = await seedInstructorSpine(ctx, fx);
  } finally {
    await ctx.dispose();
  }
});

test.afterAll(async () => {
  await fx?.dispose();
});

function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1e4)}`;
}

/**
 * A lesson of this instructor's own, created fresh for one test.
 *
 * Activity tests mutate the lesson they run against (add, duplicate, remove),
 * so sharing one lesson across them would make each test's starting state
 * depend on the order the others ran in.
 */
async function freshLesson(page: import("@playwright/test").Page, label: string): Promise<number> {
  const moduleRow = await (
    await page.request.post(`${AI_TUTOR_API_URL}/api/courses/${fx.course.atCourseId}/modules`, {
      data: { title: unique(`${label} Module`) },
    })
  ).json();
  const lesson = await (
    await page.request.post(`${AI_TUTOR_API_URL}/api/modules/${moduleRow.id}/lessons`, {
      data: { title: unique(`${label} Lesson`) },
    })
  ).json();
  return lesson.id;
}

test.describe("INSTRUCTOR activity authoring", () => {
  test("authors an MCQ activity end to end", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const lessonId = await freshLesson(page, "MCQ");
    await gotoAiTutor(page, `/instructor/lesson/${lessonId}`);
    const question = unique("Which base case ends the recursion?");

    await page.getByRole("button", { name: "Add activity" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Author a new question for this lesson.");

    await dialog.getByLabel(/Question prompt/).fill(question);
    await dialog.getByRole("textbox", { name: "Option A" }).fill("The base case");
    await dialog.getByRole("textbox", { name: "Option B" }).fill("The recursive case");
    // The form ships four choice slots and saves every one of them, blank
    // included — so an unused slot has to be removed rather than left empty, or
    // the activity reaches students with two blank options to pick from.
    await dialog.getByRole("button", { name: "Remove option D" }).click();
    await dialog.getByRole("button", { name: "Remove option C" }).click();
    // The correct answer is chosen by clicking the letter, and the form says so
    // rather than defaulting silently.
    await dialog.getByRole("button", { name: "Mark option A correct" }).click();

    // The main topic comes from the course's Core-synced topics.
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: fx.seededTopic! }).click();

    await dialog.getByLabel(/^Hint/).fill("Think about what stops the calls.");
    await dialog.getByRole("button", { name: "Add activity" }).click();

    await expect(dialog).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText(question)).toBeVisible({ timeout: 30_000 });

    // The wire contract is what matters: choices land in `options` and the key
    // in `answer`. A form that posted them at the top level would be stripped by
    // Zod and the activity would render as an unanswerable question.
    const activities = await (
      await page.request.get(`${AI_TUTOR_API_URL}/api/lessons/${lessonId}/activities`)
    ).json();
    const rows = Array.isArray(activities) ? activities : activities.data;
    const saved = rows.find((a: { question: string }) => a.question === question);
    expect(saved, "the authored activity must come back from the API").toBeTruthy();
    expect(saved.options?.choices ?? []).toEqual(["The base case", "The recursive case"]);
    expect(saved.answer?.correctIndex, "the marked letter is the saved key").toBe(0);
    // The topic picked above is really attached, not just displayed —
    // `mapActivity` emits it as `mainTopic: {id,name}`.
    expect(saved.mainTopic?.name, "the chosen main topic is persisted").toBe(fx.seededTopic);
  });

  test("an unused choice slot is saved blank unless it is removed", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const lessonId = await freshLesson(page, "Blank Choices");
    await gotoAiTutor(page, `/instructor/lesson/${lessonId}`);
    const question = unique("Two-option question left with four slots");

    await page.getByRole("button", { name: "Add activity" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Question prompt/).fill(question);
    await dialog.getByRole("textbox", { name: "Option A" }).fill("First");
    await dialog.getByRole("textbox", { name: "Option B" }).fill("Second");
    await dialog.getByRole("button", { name: "Mark option A correct" }).click();
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: fx.seededTopic! }).click();
    await dialog.getByRole("button", { name: "Add activity" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });

    // Pinning current behaviour, not endorsing it: the two untouched slots are
    // persisted as empty strings rather than dropped, so a student is offered
    // four options of which two are blank. The form gives no warning — the only
    // signal is the per-option "Remove option X" control the author has to know
    // to use. Recorded in docs/end-to-end-user-workflows/ai-tutor-workflows.md.
    const activities = await (
      await page.request.get(`${AI_TUTOR_API_URL}/api/lessons/${lessonId}/activities`)
    ).json();
    const rows = Array.isArray(activities) ? activities : activities.data;
    const saved = rows.find((a: { question: string }) => a.question === question);
    expect(saved.options?.choices).toEqual(["First", "Second", "", ""]);
  });

  test("an MCQ saves with no correct answer marked, keyed to option A (known defect)", async ({
    page,
  }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const lessonId = await freshLesson(page, "Answer Gate");
    await gotoAiTutor(page, `/instructor/lesson/${lessonId}`);
    const question = unique("Ungraded question");

    await page.getByRole("button", { name: "Add activity" }).click();
    const dialog = page.getByRole("dialog");

    await dialog.getByLabel(/Question prompt/).fill(question);
    await dialog.getByRole("textbox", { name: "Option A" }).fill("First");
    await dialog.getByRole("textbox", { name: "Option B" }).fill("Second");
    await dialog.getByRole("button", { name: "Remove option D" }).click();
    await dialog.getByRole("button", { name: "Remove option C" }).click();
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: fx.seededTopic! }).click();

    // The hint is on screen and no letter has been marked…
    await expect(dialog.getByText("No correct answer selected yet.")).toBeVisible();

    // …and the form saves anyway. `hasSelectedCorrect` is display-only: it
    // styles the marked letter and renders the line above, and nothing else
    // reads it. `handleAddActivity` guards the question, the main topic and the
    // AI-mode pair but never the answer key, and the submit button is
    // `disabled={busy || !question.trim()}`.
    await expect(dialog.getByRole("button", { name: "Add activity" })).toBeEnabled();
    await dialog.getByRole("button", { name: "Add activity" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });

    // Pinning current behaviour, not endorsing it: `correct` is still at its
    // `useState(0)` default, so option A silently becomes the key and students
    // are graded against it. Recorded as Finding #4 in
    // docs/end-to-end-user-workflows/ai-tutor-workflows.md. When the form gains
    // a real gate, this test should assert the dialog *stays open* with an
    // error instead.
    const activities = await (
      await page.request.get(`${AI_TUTOR_API_URL}/api/lessons/${lessonId}/activities`)
    ).json();
    const rows = Array.isArray(activities) ? activities : activities.data;
    const saved = rows.find((a: { question: string }) => a.question === question);
    expect(saved, "the un-keyed activity was saved rather than refused").toBeTruthy();
    expect(saved.answer?.correctIndex).toBe(0);

    // Marking a letter does clear the hint — the hint itself works, it just
    // gates nothing.
    await page.getByRole("button", { name: "Add activity" }).first().click();
    const second = page.getByRole("dialog");
    await second.getByRole("button", { name: "Mark option A correct" }).click();
    await expect(second.getByText("No correct answer selected yet.")).toHaveCount(0);
  });

  test("switches the activity type to short answer", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const lessonId = await freshLesson(page, "Short Answer");
    await gotoAiTutor(page, `/instructor/lesson/${lessonId}`);

    await page.getByRole("button", { name: "Add activity" }).click();
    const dialog = page.getByRole("dialog");

    // The type toggle swaps the MCQ choice grid for a single expected-answer
    // field, rather than leaving both on screen for the author to reconcile.
    // It is a radio group, not a pair of buttons — the two types are exclusive.
    await expect(dialog.getByRole("textbox", { name: "Option A" })).toBeVisible();
    await dialog.getByRole("radio", { name: "Short answer" }).click();
    await expect(dialog.getByRole("textbox", { name: "Option A" })).toHaveCount(0);
    await expect(dialog.getByLabel(/answer/i).first()).toBeVisible();
  });

  test("tags an activity with a course topic", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, `/instructor/lesson/${spine.lessonId}`);

    // The topic the fixture seeded in Core reaches AI Tutor through the
    // sync-on-read seam, so it is on offer here without any manual sync.
    // The labels are uppercased by CSS, so match the DOM text rather than the
    // rendered casing, and exactly — "Secondary topics" is also a prefix of the
    // picker's own "Add secondary topics…" placeholder.
    await expect(page.getByText(fx.seededTopic!).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Main topic", { exact: true })).toBeVisible();
    await expect(page.getByText("Secondary topics", { exact: true })).toBeVisible();
  });

  test("duplicates an activity", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, `/instructor/lesson/${spine.lessonId}`);

    const before = await activityCount(page, spine.lessonId);
    await page.getByRole("button", { name: "Duplicate activity" }).first().click();

    await expect
      .poll(async () => activityCount(page, spine.lessonId), { timeout: 30_000 })
      .toBe(before + 1);
  });

  test("removes an activity, confirmed first", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const lessonId = await freshLesson(page, "Removable");
    const topicIds = await (
      await page.request.get(
        `${AI_TUTOR_API_URL}/api/courses/${fx.course.atCourseId}/topics?page=1&pageSize=50`,
      )
    ).json();
    const question = unique("Doomed question");
    await page.request.post(`${AI_TUTOR_API_URL}/api/lessons/${lessonId}/activities`, {
      data: {
        question,
        type: "MCQ",
        options: ["A", "B"],
        answer: { correctIndex: 0 },
        mainTopicId: (topicIds.data ?? topicIds)[0].id,
        enableTeachMode: true,
        enableGuideMode: true,
      },
    });
    await gotoAiTutor(page, `/instructor/lesson/${lessonId}`);
    await expect(page.getByText(question)).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Remove activity" }).first().click();
    const confirm = page.getByRole("alertdialog");
    await confirm.getByRole("button", { name: "Remove" }).click();

    await expect.poll(async () => activityCount(page, lessonId), { timeout: 30_000 }).toBe(0);
  });

  test("searches the activity list", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, `/instructor/lesson/${spine.lessonId}`);

    // `.first()`: the duplicate test above shares this lesson, so the question
    // may legitimately appear more than once by the time this runs.
    await expect(page.getByText(spine.question).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("searchbox", { name: "Search activities" }).fill("zzz-nothing-matches");
    await expect(page.getByText(spine.question)).toHaveCount(0, { timeout: 30_000 });
  });

  test("imports an activity from another lesson", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const lessonId = await freshLesson(page, "Import Target");
    await gotoAiTutor(page, `/instructor/lesson/${lessonId}`);

    await page.getByRole("button", { name: "Import", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Import activity");

    // The picker searches across every activity this instructor can reach, so
    // the spine activity from another lesson is on offer. Its search field is a
    // cmdk input inside the popover, addressed by placeholder rather than by an
    // accessible name it does not carry.
    await dialog.getByRole("combobox").click();
    await page.getByPlaceholder("Search all your activities…").fill(spine.question);
    await page
      .getByRole("option", {
        name: new RegExp(spine.question.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      })
      .first()
      .click();

    await dialog
      .getByRole("button", { name: /^Import/ })
      .last()
      .click();

    await expect
      .poll(async () => activityCount(page, lessonId), { timeout: 30_000 })
      .toBeGreaterThan(0);
  });
});

/** Number of activities on a lesson, read from the API the page renders from. */
async function activityCount(
  page: import("@playwright/test").Page,
  lessonId: number,
): Promise<number> {
  const res = await page.request.get(`${AI_TUTOR_API_URL}/api/lessons/${lessonId}/activities`);
  const body = await res.json();
  return (Array.isArray(body) ? body : (body.data ?? [])).length;
}
