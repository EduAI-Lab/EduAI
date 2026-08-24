/**
 * AI Tutor UNIT_ADMIN — content authoring workflows (browser-driven).
 *
 * A unit admin authors course content on exactly the same screens an
 * instructor uses: `canManageContent()` admits the `unit` access level, so the
 * module/lesson/activity actions are all unlocked for courses inside
 * `authorizedUnits`.
 *
 * The fixture course is published in Core up front. AI Tutor enforces a
 * publish cascade (a module can only be published under a published course, a
 * lesson only under a published module), and the course-detail page carries no
 * course-level publish control of its own — the only one in the app is on the
 * dashboard's "Needs attention" panel (unit-admin-dashboard.spec.ts). Without
 * `publishCourse` here the very first publish step would be blocked.
 *
 * Each test builds its own module so the file can run in any order; the
 * fixture itself is shared because provisioning it is expensive.
 */
import { test, expect, type Page } from "@playwright/test";
import { AI_TUTOR_API_URL, AI_TUTOR_URL } from "../../playwright.config";
import { signInThroughPage } from "../helpers/auth";
import { createUnitAdmin, type UnitAdminFixture } from "../helpers/at-unit-admin";

let ua: UnitAdminFixture;
let coursePath: string;

test.beforeAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  try {
    // `seedTopic` puts a real topic on the course through Core. Without it the
    // course has none, the activity form's topic pickers are disabled for
    // *every* role, and "the picker is enabled" would prove nothing about this
    // role's access below.
    ua = await createUnitAdmin(playwright, ctx, { publishCourse: true, seedTopic: true });
  } finally {
    await ctx.dispose();
  }
  coursePath = `${AI_TUTOR_URL}/instructor/courses/${ua.course.atCourseId}`;
});

test.afterAll(async () => {
  await ua?.dispose();
});

/** Unique per test so tests never collide on the shared fixture course. */
function uniqueTitle(prefix: string): string {
  return `${prefix} ${Math.floor(Math.random() * 1e6)}`;
}

/** The module card for `title` — a role=button card, not a link. */
function moduleCard(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(title) }).first();
}

/**
 * Every "More options" kebab on the page, and *only* the kebabs.
 *
 * Module and lesson cards are themselves `role="button"`, and an accessible
 * name computed from contents swallows the nested kebab's label — so the plain
 * `getByRole("button", { name: "More options" })` matches the card as well as
 * the button inside it (Playwright's `name` is a substring match by default).
 * That doubles every count, and `.first()` resolves to the *card*, so clicking
 * it navigates away instead of opening the menu. `exact` is what separates them.
 */
function kebabs(page: Page) {
  return page.getByRole("button", { name: "More options", exact: true });
}

/**
 * The lesson card for `title`.
 *
 * `LessonCard` sets no `aria-label`, so like `ModuleCard` its accessible name is
 * computed from its contents ("01 LESSON Draft More options <title> ...") — there
 * is no "Lesson: <title>" name to match on.
 */
function lessonCard(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(title) }).first();
}

/** The kebab belonging to `title`'s lesson card. */
function lessonKebab(page: Page, title: string) {
  return lessonCard(page, title).getByRole("button", { name: "More options", exact: true });
}

/**
 * Create a module through the Add module dialog, then narrow the list to it.
 *
 * The module list is paged and every test in this file adds to the same
 * fixture course, so a freshly created module is not necessarily on the page
 * currently on screen. Searching for it is what makes the card addressable.
 */
async function addModule(page: Page, title: string) {
  await page.getByRole("button", { name: "Add module" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Module title").fill(title);
  await dialog.getByRole("button", { name: "Add module" }).click();
  await expect(dialog).toHaveCount(0);

  const search = page.getByRole("searchbox", { name: "Search modules" });
  await expect(async () => {
    await search.fill(title);
    await expect(search).toHaveValue(title, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });

  await expect(moduleCard(page, title)).toBeVisible({ timeout: 15_000 });
  // The search has to have actually replaced the list, not just accepted the
  // keystrokes — otherwise a stale row is still on screen and its kebab is the
  // one a `.first()` query would find.
  await expect(kebabs(page)).toHaveCount(1);
}

/** The kebab menu trigger belonging to `title`'s card. */
function moduleKebab(page: Page, title: string) {
  return moduleCard(page, title).getByRole("button", { name: "More options", exact: true });
}

/**
 * Open the module a test just created.
 *
 * The card is a role=button div whose onClick navigates. It is re-rendered as
 * the debounced module search settles, which can swallow the first click, so
 * the click is retried until the route actually changes.
 */
async function openModule(page: Page, title: string) {
  await expect(async () => {
    await moduleCard(page, title).click({ timeout: 3_000 });
    await expect(page).toHaveURL(/\/instructor\/module\/\d+/, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
}

/** Add a lesson to the module page currently on screen. */
async function addLesson(page: Page, title: string) {
  await page.getByRole("button", { name: "Add lesson" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").first().fill(title);
  await dialog.getByRole("button", { name: "Add lesson" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(lessonCard(page, title)).toBeVisible();
}

/** Build module -> lesson and land on the lesson page; returns the lesson id. */
async function openNewLessonPage(page: Page, prefix: string): Promise<number> {
  const moduleTitle = uniqueTitle(`${prefix} Host`);
  await addModule(page, moduleTitle);
  await openModule(page, moduleTitle);

  const lessonTitle = uniqueTitle(`${prefix} Lesson`);
  await addLesson(page, lessonTitle);
  await lessonCard(page, lessonTitle).click();
  await expect(page).toHaveURL(/\/instructor\/lesson\/\d+/, { timeout: 15_000 });
  return Number(page.url().split("/").pop());
}

test.describe("UNIT_ADMIN content authoring", () => {
  test("a unit admin creates a module in a course in their unit", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);
    const title = uniqueTitle("Unit Module");

    await addModule(page, title);

    // New content always starts as a draft, whatever the parent's state.
    await expect(moduleCard(page, title)).toContainText("Draft");
  });

  test("the module kebab publishes a module once its course is published", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);
    const title = uniqueTitle("Publishable Module");
    await addModule(page, title);

    // The card shows publish *state*; the kebab carries the publish *action*.
    await moduleKebab(page, title).click();
    const menu = page.getByRole("menu");
    await expect(menu).toContainText("Hidden from students");
    await menu.getByRole("menuitem", { name: "Publish module" }).click();

    // Publishing is confirmed first, and the confirm names the module it is
    // about, so the wrong row cannot be published by accident.
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Students will be able to see this content.");
    await expect(confirm).toContainText(title);
    await confirm.getByRole("button", { name: "Publish", exact: true }).click();

    await expect(moduleCard(page, title)).toContainText("Published");
  });

  test("the module kebab offers edit and delete alongside publish", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);
    const title = uniqueTitle("Kebab Module");
    await addModule(page, title);

    await moduleKebab(page, title).click();

    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Publish module" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Edit module" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Delete module" })).toBeVisible();
  });

  test("the module kebab renames a module", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);
    const title = uniqueTitle("Rename Me");
    await addModule(page, title);

    await moduleKebab(page, title).click();
    await page.getByRole("menu").getByRole("menuitem", { name: "Edit module" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Edit module" })).toBeVisible();
    const renamed = uniqueTitle("Renamed Module");
    await dialog.getByLabel("Module title").fill(renamed);
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toHaveCount(0);

    // The search box still holds the *old* title, so the renamed card dropping
    // out of the filtered list is itself the proof the write landed.
    await expect(moduleCard(page, title)).toHaveCount(0);
    const search = page.getByRole("searchbox", { name: "Search modules" });
    await expect(async () => {
      await search.fill(renamed);
      await expect(search).toHaveValue(renamed, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(moduleCard(page, renamed)).toBeVisible({ timeout: 15_000 });
  });

  test("the module kebab deletes a module after confirming by name", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);
    const title = uniqueTitle("Delete Me");
    await addModule(page, title);

    await moduleKebab(page, title).click();
    await page.getByRole("menu").getByRole("menuitem", { name: "Delete module" }).click();

    // The confirm names the module and says what else goes with it, so the
    // wrong row cannot be destroyed by a stray click.
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Delete module" })).toBeVisible();
    await expect(dialog).toContainText(title);
    await expect(dialog).toContainText("removes its lessons and activities");
    await dialog.getByRole("button", { name: "Delete module" }).click();
    await expect(dialog).toHaveCount(0);

    // The search is still narrowed to this title, so an empty list is the proof.
    await expect(moduleCard(page, title)).toHaveCount(0);
  });

  test("a lesson publishes once its own module is published", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);
    const moduleTitle = uniqueTitle("Publishable Host");
    await addModule(page, moduleTitle);

    // Clear the cascade at every level: the course is published by the fixture,
    // so publishing the module is what unblocks the lesson below.
    await moduleKebab(page, moduleTitle).click();
    await page.getByRole("menu").getByRole("menuitem", { name: "Publish module" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await expect(moduleCard(page, moduleTitle)).toContainText("Published");

    await openModule(page, moduleTitle);
    const lessonTitle = uniqueTitle("Publishable Lesson");
    await addLesson(page, lessonTitle);

    const card = lessonCard(page, lessonTitle);
    await expect(card).toContainText("Draft");

    await lessonKebab(page, lessonTitle).click();
    const menu = page.getByRole("menu");
    // The blocked-cascade copy from the sibling test must be gone.
    await expect(menu).toContainText("Hidden from students");
    await menu.getByRole("menuitem", { name: "Publish lesson" }).click();

    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText(lessonTitle);
    await confirm.getByRole("button", { name: "Publish", exact: true }).click();

    await expect(card).toContainText("Published");
  });

  test("the lesson kebab deletes a lesson after confirming by name", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);
    const moduleTitle = uniqueTitle("Lesson Delete Host");
    await addModule(page, moduleTitle);
    await openModule(page, moduleTitle);

    const lessonTitle = uniqueTitle("Doomed Lesson");
    await addLesson(page, lessonTitle);
    await expect(page.getByText("1 Lesson", { exact: true })).toBeVisible();

    await lessonKebab(page, lessonTitle).click();
    await page.getByRole("menu").getByRole("menuitem", { name: "Delete lesson" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Delete lesson" })).toBeVisible();
    await expect(dialog).toContainText(lessonTitle);
    await dialog.getByRole("button", { name: "Delete lesson" }).click();
    await expect(dialog).toHaveCount(0);

    await expect(lessonCard(page, lessonTitle)).toHaveCount(0);
    await expect(page.getByText("No lessons yet")).toBeVisible();
  });

  test("the lesson import panel opens and asks for a source course", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);
    const moduleTitle = uniqueTitle("Lesson Import Host");
    await addModule(page, moduleTitle);
    await openModule(page, moduleTitle);

    // Import is an inline panel on the module page, not a dialog — the button
    // toggles it and renames itself, which is how we know it actually opened.
    await page.getByRole("button", { name: "Import lessons" }).click();

    await expect(page.getByText("Choose course", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Close import" })).toBeVisible();

    await page.getByRole("button", { name: "Close import" }).click();
    await expect(page.getByText("Choose course", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Import lessons" })).toBeVisible();
  });

  test("a unit admin adds a lesson inside a module", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);
    const moduleTitle = uniqueTitle("Lesson Host");
    await addModule(page, moduleTitle);
    await openModule(page, moduleTitle);

    await expect(page.getByText("No lessons yet")).toBeVisible();
    await page.getByRole("button", { name: "Add lesson" }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(`Create a new lesson in ${moduleTitle}`);
    const lessonTitle = uniqueTitle("Unit Lesson");
    await dialog.getByRole("textbox").first().fill(lessonTitle);
    await dialog.getByRole("button", { name: "Add lesson" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(lessonCard(page, lessonTitle)).toBeVisible();
    await expect(page.getByText("1 Lesson", { exact: true })).toBeVisible();
  });

  test("the publish cascade blocks a lesson under an unpublished module", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);
    const moduleTitle = uniqueTitle("Draft Host");
    await addModule(page, moduleTitle);
    await openModule(page, moduleTitle);

    const lessonTitle = uniqueTitle("Blocked Lesson");
    await addLesson(page, lessonTitle);

    // The module was never published, so its lesson cannot be either — and the
    // menu says which parent to publish first rather than just disabling.
    await lessonKebab(page, lessonTitle).click();
    await expect(page.getByRole("menu")).toContainText(
      `${moduleTitle} is unpublished, so you can't publish ${lessonTitle}.`,
    );
  });

  test("the module page offers lesson import alongside lesson creation", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);
    const moduleTitle = uniqueTitle("Import Host");
    await addModule(page, moduleTitle);
    await openModule(page, moduleTitle);

    await expect(page.getByRole("button", { name: "Import lessons" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add lesson" }).first()).toBeVisible();
    // Counts come from the module's own rollup.
    await expect(page.getByText("0 Lessons", { exact: true })).toBeVisible();
  });

  test("a unit admin reaches the activity authoring form on a lesson", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);
    await openNewLessonPage(page, "Activity");

    await expect(page.getByRole("heading", { name: "Activities" })).toBeVisible();
    await page.getByRole("button", { name: "Add activity" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Add activity" })).toBeVisible();
    // Question type is a radio group; MCQ is the default.
    await expect(dialog.getByRole("radio", { name: "MCQ" })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: "Short answer" })).toBeVisible();
    // The MCQ choice grid, with a correct-answer picker on each letter.
    await expect(dialog.getByRole("button", { name: "Mark option A correct" })).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Question prompt *" })).toBeVisible();
    // Per-activity AI mode toggles, both on by default.
    await expect(dialog.getByRole("button", { name: "Teach me" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(dialog.getByRole("button", { name: "Guide me" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The submit button gates on the prompt alone (`disabled={busy ||
    // !question.trim()}`) — a correct answer is *not* part of that condition,
    // so it enables as soon as a prompt exists. A main topic is not part of it
    // either; that requirement is enforced on submit instead (see below).
    await expect(dialog.getByRole("button", { name: "Add activity" })).toBeDisabled();
    await dialog.getByRole("textbox", { name: "Question prompt *" }).fill("What is 2 + 2?");
    await expect(dialog.getByRole("button", { name: "Add activity" })).toBeEnabled();
  });

  test("the activity form switches from MCQ to a short-answer expected answer", async ({
    page,
  }) => {
    await signInThroughPage(page, ua, coursePath);
    await openNewLessonPage(page, "Short Answer");
    await page.getByRole("button", { name: "Add activity" }).click();

    const dialog = page.getByRole("dialog");
    // MCQ's choice grid gives way to a single expected-answer field.
    await expect(dialog.getByRole("button", { name: "Mark option A correct" })).toBeVisible();
    await dialog.getByRole("radio", { name: "Short answer" }).click();

    await expect(dialog.getByRole("button", { name: "Mark option A correct" })).toHaveCount(0);
    await expect(dialog.getByLabel("Expected answer")).toBeVisible();
    // The hint field is shared by both question types.
    await expect(dialog.getByLabel(/^Hint/)).toBeVisible();
  });

  test("a unit admin saves an activity, tagged with a topic that came from Core", async ({
    page,
  }) => {
    await signInThroughPage(page, ua, coursePath);
    const lessonId = await openNewLessonPage(page, "Activity Save");
    await page.getByRole("button", { name: "Add activity" }).click();

    // A complete, valid MCQ: prompt, choices, correct answer, hint.
    const dialog = page.getByRole("dialog");
    const prompt = uniqueTitle("What is 2 + 2?");
    await dialog.getByRole("textbox", { name: "Question prompt *" }).fill(prompt);
    await dialog.getByRole("textbox", { name: "Option A" }).fill("4");
    await dialog.getByRole("textbox", { name: "Option B" }).fill("5");
    await dialog.getByRole("button", { name: "Mark option A correct" }).click();
    await dialog.getByLabel(/^Hint/).fill("Count on your fingers.");

    // `handleAddActivity` returns early without a main topic, so this is the
    // step the topics denial used to make impossible: a unit admin could not
    // save a single activity on a course in their own unit, because the picker
    // never had anything in it to choose.
    const mainTopic = dialog.getByRole("combobox", { name: "Main topic" });
    await expect(mainTopic).toBeEnabled();
    await mainTopic.click();
    await page.getByRole("option", { name: ua.seededTopic!, exact: true }).click();

    await dialog.getByRole("button", { name: "Add activity" }).click();

    // The dialog closes only on a resolved save; the early return would leave it
    // open with "Select a main topic to continue." instead.
    await expect(dialog.getByText("Select a main topic to continue.")).toHaveCount(0);
    await expect(dialog).toHaveCount(0);

    // The write really landed.
    const activities = await (
      await page.request.get(`${AI_TUTOR_API_URL}/api/lessons/${lessonId}/activities`)
    ).json();
    expect(activities.total).toBe(1);
    // The prompt is the activity's *question*, not its instructions:
    // `activityManagement.createActivity` defaults `instructionsMd` to
    // "Answer the question." and stores what was typed in `config.question`,
    // which `mapActivity` exposes as `question`. Asserting on `instructionsMd`
    // could only ever have matched the default.
    expect(activities.data[0].question).toContain(prompt);
    expect(activities.data[0].mainTopic?.name).toBe(ua.seededTopic);
  });

  test("the activity form loads the course's topics for a unit admin", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);
    await openNewLessonPage(page, "Topic");
    await page.getByRole("button", { name: "Add activity" }).click();

    // `ensureCourseTopicAccess` (server/src/services/topicManagement.js) now
    // resolves staff through `isCourseAdmin`, the same predicate every other
    // course-scoped gate uses, so a UNIT_ADMIN is in scope for a course in
    // their `authorizedUnits`. It used to consult only the local membership
    // tables and 403 this role on its own unit's courses.
    const topicsRes = await page.request.get(
      `${AI_TUTOR_API_URL}/api/courses/${ua.course.atCourseId}/topics?page=1&pageSize=200`,
    );
    expect(topicsRes.status()).toBe(200);
    expect(((await topicsRes.json()).data as Array<{ name: string }>).map((t) => t.name)).toContain(
      ua.seededTopic,
    );

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Could not load topics for this course.")).toHaveCount(0);
    // Enabled *and* populated. `AddActivityPanel` also disables the picker when
    // `topics.length === 0`, so "enabled" only means something because the
    // fixture seeded a real topic through Core — and that topic has to be
    // selectable, not merely counted.
    const mainTopic = dialog.getByRole("combobox", { name: "Main topic" });
    await expect(mainTopic).toBeEnabled();
    await mainTopic.click();
    await expect(page.getByRole("option", { name: ua.seededTopic!, exact: true })).toBeVisible();
  });

  test("a unit admin and the course's instructor read the same topics", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);
    const url = `${AI_TUTOR_API_URL}/api/courses/${ua.course.atCourseId}/topics?page=1&pageSize=200`;

    // Same course, same endpoint, two roles — the answer must not depend on
    // which of them is asking. This is the pairing that exposed the gap: the
    // instructor's 200 proves the course really has a topic to return, so a
    // unit admin's failure could never be explained away as an empty list.
    const asInstructor = await ua.instrCtx.get(url);
    expect(asInstructor.status()).toBe(200);
    const instructorTopics = ((await asInstructor.json()).data as Array<{ name: string }>).map(
      (t) => t.name,
    );
    expect(instructorTopics).toContain(ua.seededTopic);

    const asUnitAdmin = await page.request.get(url);
    expect(asUnitAdmin.status()).toBe(200);
    const unitAdminTopics = ((await asUnitAdmin.json()).data as Array<{ name: string }>).map(
      (t) => t.name,
    );
    expect(unitAdminTopics).toEqual(instructorTopics);
  });

  test("the course hero shows the course's topic chips to a unit admin", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);

    // `instructor.course.tsx` feeds the hero's topic chips from the same
    // `useCourseTopics` hook the activity form uses — the second surface the
    // topics gate governs. The chips used to vanish silently here, with no
    // error anywhere on the page to explain their absence.
    await expect(page.getByRole("heading", { name: ua.course.name, level: 1 })).toBeVisible();
    await expect(page.getByText(ua.seededTopic!).first()).toBeVisible({ timeout: 15_000 });
  });

  test("a unit admin cannot add topics to a Core-imported course", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);

    // Not a bug, and not the gap fixed above: reading a course's topics is one
    // decision, creating one is another. Topics on an imported course are owned
    // by EduAI Core and are added there — a local addition would be wiped by
    // the next sync, so the write is refused by design for every role.
    //
    // The message matters as much as the status: a bare 403 would also be what
    // a *course-access* denial looks like, and this must be the imported-course
    // rule instead.
    const res = await page.request.post(
      `${AI_TUTOR_API_URL}/api/courses/${ua.course.atCourseId}/topics`,
      { data: { name: "E2E Unit Admin Topic" } },
    );
    expect(res.status()).toBe(403);
    const { error } = await res.json();
    expect(error).toMatch(/managed by EduAI/i);
    expect(error).not.toMatch(/Not authorized for this course/i);
  });
});
