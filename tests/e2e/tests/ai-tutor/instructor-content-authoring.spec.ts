/**
 * AI Tutor INSTRUCTOR — module and lesson authoring workflows (browser-driven).
 *
 * `canManageContent()` admits the `instructor` access level, so an instructor
 * gets the full authoring surface on the courses they teach: create, rename,
 * reorder, publish and delete modules and lessons, plus the cross-course import
 * panels. Course *creation* is not here for any role — it is owned by EduAI
 * Core (#632) — and neither is course publish, which lives only on the
 * dashboard's drafts panel.
 *
 * Publish is a cascade: a lesson cannot be published while its module or course
 * is unpublished. The fixture therefore publishes the course in Core, and the
 * cascade tests drive the module's state to reach each side of the gate.
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
/** A module + lesson in the *second* taught course, used as the import source. */
let source: Awaited<ReturnType<typeof seedInstructorSpine>>;

test.beforeAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  try {
    fx = await createTeachingInstructor(playwright, ctx, {
      publishCourse: true,
      secondCourse: true,
      seedTopic: true,
    });
    // Deliberately in the *second* taught course: an import needs a source that
    // is not the destination, and it must be a course this instructor can
    // actually reach — which is the same thing the picker is scoped to.
    source = await seedInstructorSpine(ctx, fx, { atCourseId: fx.second!.atCourseId });
  } finally {
    await ctx.dispose();
  }
});

test.afterAll(async () => {
  await fx?.dispose();
});

/** A unique title so parallel/retried runs never collide on a name. */
function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1e4)}`;
}

/**
 * The module/lesson card for `title`.
 *
 * Two things make this less obvious than `getByRole("button", { name })`:
 *   - `ModuleCard`/`LessonCard` are `role=button` elements whose accessible name
 *     is their entire contents, so titles must be regex-escaped — a name like
 *     "… (renamed)" would otherwise be read as a capture group and silently stop
 *     matching the literal parentheses on the page.
 *   - Once a list holds two or more rows, each card grows a `DragHandle` button
 *     named "Drag to reorder <title>", which matches the same name. It carries no
 *     text of its own, so filtering on visible text keeps the card and drops it.
 */
function card(page: import("@playwright/test").Page, title: string) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.getByRole("button", { name: new RegExp(escaped) }).filter({ hasText: title });
}

/** Open the kebab menu on the card whose title is `title`. */
async function openKebab(page: import("@playwright/test").Page, title: string) {
  // Scoped through the card rather than found page-wide — otherwise the first
  // kebab on the page wins regardless of which row it belongs to.
  const row = card(page, title);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("button", { name: "More options" }).click();
}

test.describe("INSTRUCTOR module authoring", () => {
  test("creates a module in a course they teach", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, `/instructor/courses/${fx.course.atCourseId}`);
    const title = unique("E2E Created Module");

    await page.getByRole("button", { name: "Add module" }).click();
    const dialog = page.getByRole("dialog");
    // The dialog names the course it writes into, so a mis-navigated author
    // finds out before saving rather than after.
    await expect(dialog).toContainText(fx.course.name);
    await dialog.getByLabel("Module title").fill(title);
    await dialog.getByLabel("Description").fill("Created by the instructor E2E suite.");
    await dialog.getByRole("button", { name: "Add module" }).click();

    // New content starts as a draft — publishing is a separate, confirmed step.
    const created = card(page, title);
    await expect(created).toBeVisible({ timeout: 30_000 });
    await expect(created).toContainText("Draft");
  });

  test("renames a module from its kebab menu", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const original = unique("E2E Rename Module");
    const renamed = `${original} (renamed)`;
    await page.request.post(`${AI_TUTOR_API_URL}/api/courses/${fx.course.atCourseId}/modules`, {
      data: { title: original },
    });
    await gotoAiTutor(page, `/instructor/courses/${fx.course.atCourseId}`);

    await openKebab(page, original);
    await page.getByRole("menuitem", { name: "Edit module" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Edit module");
    await dialog.getByLabel("Module title").fill(renamed);
    await dialog.getByRole("button", { name: "Save changes" }).click();

    await expect(card(page, renamed)).toBeVisible({
      timeout: 30_000,
    });
  });

  test("publishes a module from its kebab menu", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const title = unique("E2E Publish Module");
    const created = await (
      await page.request.post(`${AI_TUTOR_API_URL}/api/courses/${fx.course.atCourseId}/modules`, {
        data: { title },
      })
    ).json();
    await gotoAiTutor(page, `/instructor/courses/${fx.course.atCourseId}`);

    await openKebab(page, title);
    // State (the card's badge) and action (this menu) are kept separate, so a
    // click meant to read the state cannot change it.
    await expect(page.getByRole("menuitem", { name: "Publish module" })).toBeVisible();
    await page.getByRole("menuitem", { name: "Publish module" }).click();

    // Confirmed by name, and the confirm states who gains access.
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText(title);
    await expect(confirm).toContainText("Students will be able to see this content.");
    await confirm.getByRole("button", { name: "Publish", exact: true }).click();

    await expect(card(page, title)).toContainText("Published", {
      timeout: 30_000,
    });
    const after = await (
      await page.request.get(`${AI_TUTOR_API_URL}/api/modules/${created.id}`)
    ).json();
    expect(after.isPublished).toBe(true);
  });

  test("deletes a module, and the confirm says what goes with it", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const title = unique("E2E Delete Module");
    await page.request.post(`${AI_TUTOR_API_URL}/api/courses/${fx.course.atCourseId}/modules`, {
      data: { title },
    });
    await gotoAiTutor(page, `/instructor/courses/${fx.course.atCourseId}`);

    await openKebab(page, title);
    await page.getByRole("menuitem", { name: "Delete module" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(title);
    // Deleting a module is not a leaf operation — the confirm has to say that
    // its lessons and activities go too, or the blast radius is a surprise.
    await expect(dialog).toContainText(/lesson/i);
    await dialog.getByRole("button", { name: "Delete" }).click();

    await expect(card(page, title)).toHaveCount(0, {
      timeout: 30_000,
    });
  });

  test("moves a module to an explicit position", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    // Two modules minimum: the move affordance only exists once order is
    // meaningful, and the dialog reports "N of total".
    const first = unique("E2E Move Module A");
    const second = unique("E2E Move Module B");
    for (const title of [first, second]) {
      await page.request.post(`${AI_TUTOR_API_URL}/api/courses/${fx.course.atCourseId}/modules`, {
        data: { title },
      });
    }
    await gotoAiTutor(page, `/instructor/courses/${fx.course.atCourseId}`);

    await openKebab(page, second);
    // Drag-and-drop can only express a move among the rows on screen; this is
    // the only way to move a row to a different page (#1207).
    await page.getByRole("menuitem", { name: /^Move module/ }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Move module");
    await expect(dialog).toContainText(second);
    await dialog.getByLabel("New position").fill("1");
    await dialog.getByRole("button", { name: /Move|Save/ }).click();

    // The list re-orders: the moved module now heads the course.
    await expect(card(page, second)).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(
        async () => {
          const res = await page.request.get(
            `${AI_TUTOR_API_URL}/api/courses/${fx.course.atCourseId}/modules?page=1&pageSize=200`,
          );
          const body = await res.json();
          return body.data[0]?.title;
        },
        { timeout: 20_000 },
      )
      .toBe(second);
  });

  test("searches the module list, and a term matching nothing says so", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const title = unique("E2E Searchable Module");
    await page.request.post(`${AI_TUTOR_API_URL}/api/courses/${fx.course.atCourseId}/modules`, {
      data: { title },
    });
    await gotoAiTutor(page, `/instructor/courses/${fx.course.atCourseId}`);

    const box = page.getByRole("searchbox", { name: "Search modules" });
    await box.fill("E2E Searchable Module");
    await expect(card(page, title)).toBeVisible({
      timeout: 30_000,
    });
    // Server-side and bookmarkable, like the course list.
    await expect(page).toHaveURL(/[?&]search=/);

    await box.fill("zzz-no-module-matches-zzz");
    // A term matching nothing must say so rather than falling back to an
    // unfiltered list — the failure mode #1207 exists to prevent.
    await expect(page.getByText("No modules match your search.")).toBeVisible({ timeout: 30_000 });
  });

  test("imports modules from another course they teach", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await gotoAiTutor(page, `/instructor/courses/${fx.course.atCourseId}`);

    await page.getByRole("button", { name: "Import", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Import modules");
    // The dialog names the destination, and is explicit that lessons and
    // activities come along rather than just the module shell.
    await expect(dialog).toContainText(fx.course.name);
    await expect(dialog).toContainText("along with their lessons and activities");

    // The copy-from picker is scoped to courses this instructor teaches — the
    // course taught by someone else is not on offer.
    await dialog.getByRole("combobox").click();
    await expect(page.getByRole("option", { name: fx.second!.name })).toBeVisible();
    await expect(page.getByRole("option", { name: fx.foreign.name })).toHaveCount(0);
    await page.getByRole("option", { name: fx.second!.name }).click();

    // The source course's modules are named before anything is copied…
    await expect(dialog.getByText(source.moduleTitle)).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toContainText(
      "Select modules to import (lessons and activities included)",
    );

    // …and the action stays disabled until one is actually ticked. The confirm
    // is matched by prefix rather than by full name, because its name is part
    // of what this test is checking: it counts the selection. (Not "the last
    // button in the dialog" either — that is the header's Close ✕.)
    const confirm = dialog.getByRole("button", { name: /^Import/ });
    await expect(confirm).toHaveText("Import modules");
    await expect(confirm).toBeDisabled();

    await dialog.getByText(source.moduleTitle).click();
    // The label becomes a count, so the button says exactly how much is about
    // to be copied instead of leaving the author to remember what they ticked.
    await expect(confirm).toHaveText("Import 1 module");
    await expect(confirm).toBeEnabled();
    await confirm.click();

    // The copy really lands: a module by that name now exists in the
    // destination course, which had none before.
    await expect
      .poll(
        async () => {
          const res = await page.request.get(
            `${AI_TUTOR_API_URL}/api/courses/${fx.course.atCourseId}/modules?page=1&pageSize=200&search=${encodeURIComponent(source.moduleTitle)}`,
          );
          return (await res.json()).total;
        },
        { timeout: 30_000, message: "imported module never appeared in the destination course" },
      )
      .toBeGreaterThan(0);
  });
});

test.describe("INSTRUCTOR lesson authoring", () => {
  test("adds a lesson to a module", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const moduleRow = await (
      await page.request.post(`${AI_TUTOR_API_URL}/api/courses/${fx.course.atCourseId}/modules`, {
        data: { title: unique("E2E Lesson Host Module") },
      })
    ).json();
    await gotoAiTutor(page, `/instructor/module/${moduleRow.id}`);
    const title = unique("E2E Created Lesson");

    await page.getByRole("button", { name: "Add lesson" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Add lesson");
    await dialog.getByLabel("Lesson title").fill(title);
    await dialog.getByRole("button", { name: "Add lesson" }).click();

    await expect(card(page, title)).toBeVisible({
      timeout: 30_000,
    });
  });

  test("edits a lesson from its kebab menu", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const moduleRow = await (
      await page.request.post(`${AI_TUTOR_API_URL}/api/courses/${fx.course.atCourseId}/modules`, {
        data: { title: unique("E2E Edit Lesson Module") },
      })
    ).json();
    const original = unique("E2E Editable Lesson");
    await page.request.post(`${AI_TUTOR_API_URL}/api/modules/${moduleRow.id}/lessons`, {
      data: { title: original },
    });
    await gotoAiTutor(page, `/instructor/module/${moduleRow.id}`);

    await openKebab(page, original);
    await page.getByRole("menuitem", { name: "Edit lesson" }).click();

    const renamed = `${original} (edited)`;
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Lesson title").fill(renamed);
    await dialog.getByRole("button", { name: "Save changes" }).click();

    await expect(card(page, renamed)).toBeVisible({
      timeout: 30_000,
    });
  });

  test("the publish cascade blocks a lesson under an unpublished module", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const moduleTitle = unique("E2E Unpublished Parent");
    const moduleRow = await (
      await page.request.post(`${AI_TUTOR_API_URL}/api/courses/${fx.course.atCourseId}/modules`, {
        data: { title: moduleTitle },
      })
    ).json();
    const lessonTitle = unique("E2E Blocked Lesson");
    await page.request.post(`${AI_TUTOR_API_URL}/api/modules/${moduleRow.id}/lessons`, {
      data: { title: lessonTitle },
    });
    await gotoAiTutor(page, `/instructor/module/${moduleRow.id}`);

    await openKebab(page, lessonTitle);
    const item = page.getByRole("menuitem", { name: "Publish lesson" });
    await expect(item).toBeDisabled();
    // The menu names *which* parent to publish first rather than silently
    // disabling the item and leaving the author to guess.
    await expect(page.getByText(`${moduleTitle} is unpublished`)).toBeVisible();
  });

  test("publishes a lesson once its module is published", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const moduleRow = await (
      await page.request.post(`${AI_TUTOR_API_URL}/api/courses/${fx.course.atCourseId}/modules`, {
        data: { title: unique("E2E Published Parent") },
      })
    ).json();
    await page.request.patch(`${AI_TUTOR_API_URL}/api/modules/${moduleRow.id}/publish`);
    const lessonTitle = unique("E2E Publishable Lesson");
    const lesson = await (
      await page.request.post(`${AI_TUTOR_API_URL}/api/modules/${moduleRow.id}/lessons`, {
        data: { title: lessonTitle },
      })
    ).json();
    await gotoAiTutor(page, `/instructor/module/${moduleRow.id}`);

    await openKebab(page, lessonTitle);
    // Clearing the parent removes the block: the same item is now live.
    await page.getByRole("menuitem", { name: "Publish lesson" }).click();

    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText(lessonTitle);
    await confirm.getByRole("button", { name: "Publish", exact: true }).click();

    await expect
      .poll(
        async () => {
          const res = await page.request.get(`${AI_TUTOR_API_URL}/api/lessons/${lesson.id}`);
          return (await res.json()).isPublished;
        },
        { timeout: 20_000 },
      )
      .toBe(true);
  });

  test("deletes a lesson from its kebab menu", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const moduleRow = await (
      await page.request.post(`${AI_TUTOR_API_URL}/api/courses/${fx.course.atCourseId}/modules`, {
        data: { title: unique("E2E Delete Lesson Module") },
      })
    ).json();
    const lessonTitle = unique("E2E Deletable Lesson");
    await page.request.post(`${AI_TUTOR_API_URL}/api/modules/${moduleRow.id}/lessons`, {
      data: { title: lessonTitle },
    });
    await gotoAiTutor(page, `/instructor/module/${moduleRow.id}`);

    await openKebab(page, lessonTitle);
    await page.getByRole("menuitem", { name: "Delete lesson" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(lessonTitle);
    await dialog.getByRole("button", { name: "Delete" }).click();

    // The module falls back to its empty state rather than showing a stale row.
    await expect(page.getByText("No lessons yet")).toBeVisible({ timeout: 30_000 });
  });

  test("searches the lesson list", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const moduleRow = await (
      await page.request.post(`${AI_TUTOR_API_URL}/api/courses/${fx.course.atCourseId}/modules`, {
        data: { title: unique("E2E Lesson Search Module") },
      })
    ).json();
    const keep = unique("E2E Findable Lesson");
    for (const title of [keep, unique("E2E Other Lesson")]) {
      await page.request.post(`${AI_TUTOR_API_URL}/api/modules/${moduleRow.id}/lessons`, {
        data: { title },
      });
    }
    await gotoAiTutor(page, `/instructor/module/${moduleRow.id}`);

    await page.getByRole("searchbox", { name: "Search lessons" }).fill("Findable");
    await expect(card(page, keep)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: /E2E Other Lesson/ })).toHaveCount(0);
  });

  test("imports lessons from another course into this module", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const moduleRow = await (
      await page.request.post(`${AI_TUTOR_API_URL}/api/courses/${fx.course.atCourseId}/modules`, {
        data: { title: unique("E2E Lesson Import Target") },
      })
    ).json();
    await gotoAiTutor(page, `/instructor/module/${moduleRow.id}`);

    // An inline panel, not a dialog — the trigger renames itself while open.
    await page.getByRole("button", { name: "Import lessons" }).click();
    await expect(page.getByRole("button", { name: "Close import" })).toBeVisible();

    // Course, then module, then the lessons to copy: lessons have no implicit
    // destination, so the source module has to be named explicitly.
    await page.getByLabel("Choose course").click();
    await page.getByRole("option", { name: fx.second!.name }).click();
    await page.getByLabel("Choose module").click();
    await page.getByRole("option", { name: source.moduleTitle }).click();

    await expect(page.getByText(source.lessonTitle)).toBeVisible({ timeout: 30_000 });
    const confirm = page.getByRole("button", { name: "Import selected lessons" });
    await expect(confirm).toBeDisabled();
    await page.getByText(source.lessonTitle).click();
    await expect(confirm).toBeEnabled();
    await confirm.click();

    // The copy really lands in *this* module.
    await expect
      .poll(
        async () => {
          const res = await page.request.get(
            `${AI_TUTOR_API_URL}/api/modules/${moduleRow.id}/lessons?page=1&pageSize=200`,
          );
          const body = await res.json();
          return (body.data as Array<{ title: string }>).some((l) =>
            l.title.includes(source.lessonTitle),
          );
        },
        { timeout: 30_000, message: "imported lesson never appeared in the destination module" },
      )
      .toBe(true);
  });
});
