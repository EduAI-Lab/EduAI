/**
 * AI Tutor — ADMIN content actions that are *not* behind the card kebab.
 *
 * Activity edit, duplicate, move, and remove are plain icon buttons on the
 * activity card, and reordering has its own drag handle — none of them sit
 * behind the module/lesson card kebab. Those paths work and nothing covered
 * them, so a regression in any of them would have gone unnoticed.
 *
 * Companion spec: admin-content-authoring (creation paths + the card kebab).
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md`.
 */
import { test, expect } from "@playwright/test";
import { gotoAiTutor, loginAsAdmin } from "../helpers/at-ui";
import {
  seedAtCourse,
  seedCourseWithActivity,
  seedLesson,
  seedMcqActivity,
  seedModule,
} from "../helpers/at-admin-fixtures";

test.describe("AI Tutor ADMIN — activity row actions", () => {
  test("activities can be searched within a lesson", async ({ page, playwright }) => {
    const seeded = await seedCourseWithActivity(playwright, {
      name: "Activity Search Course",
      codePrefix: "ACSR",
      question: "Which case stops a recursion?",
    });
    try {
      const [topicId] = seeded.topicIds;
      await seedMcqActivity(seeded.admin, seeded.lessonId, topicId, {
        question: "What is the time complexity of binary search?",
      });

      await loginAsAdmin(page, "at-admin-activity-search");
      await gotoAiTutor(page, `/instructor/lesson/${seeded.lessonId}`);
      await expect(page.getByText("Which case stops a recursion?")).toBeVisible({
        timeout: 20_000,
      });

      const search = page.getByPlaceholder("Search activities…");
      await search.fill("binary search");
      await expect(page.getByText("What is the time complexity of binary search?")).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText("Which case stops a recursion?")).toHaveCount(0);

      await search.fill(`no-match-${Date.now()}`);
      await expect(page.getByText("No activities match your search.")).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await seeded.dispose();
    }
  });

  test("an activity's question can be edited in place", async ({ page, playwright }) => {
    const seeded = await seedCourseWithActivity(playwright, {
      name: "Activity Edit Course",
      codePrefix: "ACED",
    });
    try {
      await loginAsAdmin(page, "at-admin-activity-edit");
      await gotoAiTutor(page, `/instructor/lesson/${seeded.lessonId}`);
      await expect(page.getByText(seeded.question)).toBeVisible({ timeout: 20_000 });

      await page.getByRole("button", { name: "Edit activity" }).first().click();
      const questionField = page.getByLabel(/Question prompt/i);
      await expect(questionField).toBeVisible();

      const edited = "Which case actually stops a recursion?";
      await questionField.fill(edited);
      await page.getByRole("button", { name: /save changes/i }).click();

      await expect(page.getByText(edited)).toBeVisible({ timeout: 20_000 });
      await page.reload();
      await expect(page.getByText(edited)).toBeVisible({ timeout: 20_000 });
    } finally {
      await seeded.dispose();
    }
  });

  test("an activity can be duplicated", async ({ page, playwright }) => {
    const seeded = await seedCourseWithActivity(playwright, {
      name: "Activity Duplicate Course",
      codePrefix: "ACDU",
    });
    try {
      await loginAsAdmin(page, "at-admin-activity-duplicate");
      await gotoAiTutor(page, `/instructor/lesson/${seeded.lessonId}`);
      await expect(page.getByText(seeded.question)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(seeded.question)).toHaveCount(1);

      await page.getByRole("button", { name: "Duplicate activity" }).first().click();
      await expect(page.getByText(seeded.question)).toHaveCount(2, { timeout: 20_000 });

      // The copy is a real row, not an optimistic ghost.
      await page.reload();
      await expect(page.getByText(seeded.question)).toHaveCount(2, { timeout: 20_000 });
    } finally {
      await seeded.dispose();
    }
  });

  test("an activity can be removed, behind a confirmation", async ({ page, playwright }) => {
    const seeded = await seedCourseWithActivity(playwright, {
      name: "Activity Remove Course",
      codePrefix: "ACRM",
    });
    try {
      await loginAsAdmin(page, "at-admin-activity-remove");
      await gotoAiTutor(page, `/instructor/lesson/${seeded.lessonId}`);
      await expect(page.getByText(seeded.question)).toBeVisible({ timeout: 20_000 });

      await page.getByRole("button", { name: "Remove activity" }).first().click();

      // Destructive, so it must ask first — and cancelling must keep the row.
      const dialog = page.locator('[role="dialog"], [role="alertdialog"]');
      await expect(dialog.getByText("Remove activity?")).toBeVisible();
      await expect(dialog.getByText("This action cannot be undone.")).toBeVisible();
      await dialog.getByRole("button", { name: /cancel/i }).click();
      await expect(page.getByText(seeded.question)).toBeVisible();

      await page.getByRole("button", { name: "Remove activity" }).first().click();
      await page
        .locator('[role="dialog"], [role="alertdialog"]')
        .getByRole("button", { name: /^remove$/i })
        .click();

      await expect(page.getByText("No activities yet.")).toBeVisible({ timeout: 20_000 });
      await page.reload();
      await expect(page.getByText("No activities yet.")).toBeVisible({ timeout: 20_000 });
    } finally {
      await seeded.dispose();
    }
  });

  test("an activity can be moved to an explicit position", async ({ page, playwright }) => {
    // #1207: drag reaches only the current page, so a cross-page move needs a
    // typed destination. The control only appears once reordering is possible.
    const seeded = await seedCourseWithActivity(playwright, {
      name: "Activity Move Course",
      codePrefix: "ACMV",
      question: "First activity question",
    });
    try {
      const [topicId] = seeded.topicIds;
      await seedMcqActivity(seeded.admin, seeded.lessonId, topicId, {
        question: "Second activity question",
      });

      await loginAsAdmin(page, "at-admin-activity-move");
      await gotoAiTutor(page, `/instructor/lesson/${seeded.lessonId}`);
      await expect(page.getByText("First activity question")).toBeVisible({ timeout: 20_000 });

      // First card is the first activity.
      const cards = page.locator('[data-slot="card"]').filter({ hasText: "activity question" });
      await expect(cards.first()).toContainText("First activity question");

      await page.getByRole("button", { name: "Move activity to position" }).first().click();
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog.getByText("Move activity")).toBeVisible();
      await expect(dialog).toContainText("It is currently 1 of 2");

      await dialog.getByLabel("New position").fill("2");
      await dialog.getByRole("button", { name: /^move$/i }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });

      await page.reload();
      const reordered = page.locator('[data-slot="card"]').filter({ hasText: "activity question" });
      await expect(reordered.first()).toContainText("Second activity question", {
        timeout: 20_000,
      });
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor ADMIN — reordering by drag handle", () => {
  test("modules can be reordered with the keyboard drag handle", async ({ page, playwright }) => {
    // The grip is its own control rather than a kebab item. dnd-kit ships a
    // keyboard sensor, which is also the accessible path a real user has.
    const seeded = await seedAtCourse(playwright, {
      name: "Module Reorder Course",
      codePrefix: "MRDR",
    });
    try {
      await seedModule(seeded.admin, seeded.atCourseId, { title: "Alpha module" });
      await seedModule(seeded.admin, seeded.atCourseId, { title: "Beta module" });

      await loginAsAdmin(page, "at-admin-module-reorder");
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);

      const firstCard = () => page.locator('[role="button"]').filter({ hasText: "module" }).first();
      await expect(firstCard()).toContainText("Alpha module", { timeout: 20_000 });

      const handle = page.getByRole("button", {
        name: "Drag to reorder Alpha module",
        exact: true,
      });
      await expect(handle).toBeVisible();

      // dnd-kit's keyboard sensor needs the handle focused and its live-region
      // announcer mounted before Space starts a drag; under load the first
      // gesture can land too early and be swallowed. Retry the whole gesture
      // rather than the assertion, so one dropped keypress does not fail the
      // test — the behaviour under test is the reorder, not the timing.
      await expect(async () => {
        await handle.focus();
        await page.keyboard.press("Space");
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("Space");
        await expect(firstCard()).toContainText("Beta module", { timeout: 5_000 });
      }).toPass({ timeout: 45_000 });

      // The new order is stored, not just painted.
      await page.reload();
      await expect(firstCard()).toContainText("Beta module", { timeout: 20_000 });
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor ADMIN — module page", () => {
  test("lessons can be searched within a module", async ({ page, playwright }) => {
    const seeded = await seedAtCourse(playwright, {
      name: "Lesson Search Course",
      codePrefix: "LSRC",
    });
    try {
      const module = await seedModule(seeded.admin, seeded.atCourseId);
      await seedLesson(seeded.admin, module.id, { title: "Recursion warmup" });
      await seedLesson(seeded.admin, module.id, { title: "Graph traversal drill" });

      await loginAsAdmin(page, "at-admin-lesson-search");
      await gotoAiTutor(page, `/instructor/module/${module.id}`);
      await expect(page.getByText("Recursion warmup")).toBeVisible({ timeout: 20_000 });

      await page.getByLabel("Search lessons", { exact: true }).fill("Graph");
      await expect(page.getByText("Graph traversal drill")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("Recursion warmup")).toHaveCount(0);
    } finally {
      await seeded.dispose();
    }
  });

  test("a lesson can be created with Markdown content", async ({ page, playwright }) => {
    // The optional content field is the lesson body students read above the
    // activities; the authoring spec only ever filled the title.
    const seeded = await seedAtCourse(playwright, {
      name: "Lesson Content Course",
      codePrefix: "LCNT",
    });
    try {
      const module = await seedModule(seeded.admin, seeded.atCourseId);

      await loginAsAdmin(page, "at-admin-lesson-content");
      await gotoAiTutor(page, `/instructor/module/${module.id}`);
      await page
        .getByRole("button", { name: /^add lesson$/i })
        .first()
        .click();

      const dialog = page.locator('[role="dialog"]');
      await dialog.locator("#new-lesson-title").fill("Lesson with notes");
      await dialog.locator("#new-lesson-content").fill("## Read first\n\nSome **notes**.");
      await dialog.getByRole("button", { name: /^add lesson$/i }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });

      await expect(page.getByText("Lesson with notes")).toBeVisible({ timeout: 20_000 });
    } finally {
      await seeded.dispose();
    }
  });

  test("the import-lessons panel opens with its course and module pickers", async ({
    page,
    playwright,
  }) => {
    const seeded = await seedAtCourse(playwright, {
      name: "Lesson Import Course",
      codePrefix: "LIMP",
    });
    try {
      const module = await seedModule(seeded.admin, seeded.atCourseId);

      await loginAsAdmin(page, "at-admin-lesson-import");
      await gotoAiTutor(page, `/instructor/module/${module.id}`);

      await page.getByRole("button", { name: /^import lessons$/i }).click();
      await expect(page.getByLabel("Choose course")).toBeVisible({ timeout: 20_000 });
      // The commit action does not exist until a source module with lessons is
      // picked, so there is nothing to click by mistake.
      await expect(page.getByRole("button", { name: /import selected lessons/i })).toHaveCount(0);

      // The toggle closes again rather than stranding the panel open.
      await page.getByRole("button", { name: /^close import$/i }).click();
      await expect(page.getByLabel("Choose course")).toHaveCount(0);
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor ADMIN — lesson page bounds", () => {
  test("an unknown lesson id lands on the generic 404 inside the shell", async ({ page }) => {
    // Same fix as the unknown-course case (BUG-6), pinned for the lesson route.
    await loginAsAdmin(page, "at-admin-missing-lesson");
    await page.goto(`${page.url().replace(/\/dashboard.*$/, "")}/instructor/lesson/99999999`);
    await expect(page.getByText("404 — Page not found")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/An unexpected error occurred/i)).toHaveCount(0);
  });
});
