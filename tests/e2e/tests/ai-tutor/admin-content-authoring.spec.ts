/**
 * AI Tutor — ADMIN content-authoring workflows, driven through the browser.
 *
 * An admin holds `canManageContent` / `canPublishContent` for every course
 * (`rbac/permissions.ts`), so the authoring surface is the same as an
 * instructor's: modules on the course page, lessons on the module page,
 * activities on the lesson page, plus the cross-course import dialogs.
 *
 * Course *lifecycle* is deliberately not here — `canCreateCourse()` is hard
 * `false`; courses are created in EduAI Core and mirrored in.
 *
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md`.
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_URL } from "../../playwright.config";
import { gotoAiTutor, loginAsAdmin } from "../helpers/at-ui";
import { seedAtCourse, seedLesson, seedModule } from "../helpers/at-admin-fixtures";

test.describe("AI Tutor ADMIN — modules", () => {
  test("adds a module to another instructor's course", async ({ page, playwright }) => {
    const seeded = await seedAtCourse(playwright, { name: "Module Authoring", codePrefix: "MODA" });
    try {
      await loginAsAdmin(page, "at-admin-add-module");
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);

      await expect(page.getByText("No modules yet.")).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: /^add module$/i }).click();

      const dialog = page.locator('[role="dialog"]');
      await expect(dialog.getByRole("heading", { name: "Add module" })).toBeVisible();
      await expect(dialog).toContainText(seeded.name);
      await dialog.getByLabel(/module title/i).fill("Admin-authored module");
      // A description can be set at creation time; it used to be reachable only
      // afterwards, from the card kebab's edit dialog.
      await dialog.getByLabel(/description/i).fill("What this module covers.");
      await dialog.getByRole("button", { name: /^add module$/i }).click();

      await expect(dialog).toBeHidden({ timeout: 20_000 });
      await expect(page.getByText("Admin-authored module")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("What this module covers.")).toBeVisible();
      // New content starts hidden from students.
      await expect(page.getByText("Draft").first()).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });

  test("a module can still be created without a description", async ({ page, playwright }) => {
    // The field is optional, and a blank one is omitted rather than sent as ""
    // — a stored empty string would render as a blank description line.
    const seeded = await seedAtCourse(playwright, {
      name: "Module No Description",
      codePrefix: "MODN",
    });
    try {
      await loginAsAdmin(page, "at-admin-add-module-nodesc");
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);

      await page.getByRole("button", { name: /^add module$/i }).click();
      const dialog = page.locator('[role="dialog"]');
      await dialog.getByLabel(/module title/i).fill("Bare module");
      await dialog.getByRole("button", { name: /^add module$/i }).click();

      await expect(dialog).toBeHidden({ timeout: 20_000 });
      const card = page.getByRole("button", { name: "Module: Bare module" });
      await expect(card).toBeVisible({ timeout: 20_000 });
      await expect(card).toContainText("Bare module");
    } finally {
      await seeded.dispose();
    }
  });

  test("the module list can be searched within a course", async ({ page, playwright }) => {
    const seeded = await seedAtCourse(playwright, { name: "Module Search", codePrefix: "MODS" });
    try {
      await seedModule(seeded.admin, seeded.atCourseId, { title: "Recursion basics" });
      await seedModule(seeded.admin, seeded.atCourseId, { title: "Graph traversal" });

      await loginAsAdmin(page, "at-admin-module-search");
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);
      await expect(page.getByText("Recursion basics")).toBeVisible({ timeout: 20_000 });

      await page.getByLabel("Search modules", { exact: true }).fill("Graph");
      await expect(page.getByText("Graph traversal")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("Recursion basics")).toHaveCount(0);

      await page.getByLabel("Search modules", { exact: true }).fill(`no-match-${Date.now()}`);
      await expect(page.getByText("No modules match your search.")).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await seeded.dispose();
    }
  });

  test("the cross-course import dialog explains when there is nothing to copy", async ({
    page,
    playwright,
  }) => {
    const seeded = await seedAtCourse(playwright, { name: "Import Modules", codePrefix: "IMPM" });
    try {
      await loginAsAdmin(page, "at-admin-import-modules");
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);

      await page.getByRole("button", { name: /^import$/i }).click();
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog.getByRole("heading", { name: "Import modules" })).toBeVisible();
      await expect(dialog.getByLabel(/choose course to copy/i)).toBeVisible();
      await expect(dialog.getByText("Select a course to preview its modules.")).toBeVisible();
      // Nothing is selected yet, so the commit action stays disabled.
      await expect(dialog.getByRole("button", { name: /^import modules$/i })).toBeDisabled();
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor ADMIN — lessons", () => {
  test("adds a lesson to a module", async ({ page, playwright }) => {
    const seeded = await seedAtCourse(playwright, { name: "Lesson Authoring", codePrefix: "LESA" });
    try {
      const module = await seedModule(seeded.admin, seeded.atCourseId);

      await loginAsAdmin(page, "at-admin-add-lesson");
      await gotoAiTutor(page, `/instructor/module/${module.id}`);
      await expect(page.getByRole("heading", { name: module.title })).toBeVisible({
        timeout: 20_000,
      });

      await page
        .getByRole("button", { name: /^add lesson$/i })
        .first()
        .click();
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog.getByRole("heading", { name: "Add lesson" })).toBeVisible();
      await dialog.locator("input").first().fill("Admin-authored lesson");
      await dialog.getByRole("button", { name: /^add lesson$/i }).click();

      await expect(dialog).toBeHidden({ timeout: 20_000 });
      await expect(page.getByText("Admin-authored lesson")).toBeVisible({ timeout: 20_000 });
    } finally {
      await seeded.dispose();
    }
  });

  test("the module page summarises lesson publish state", async ({ page, playwright }) => {
    const seeded = await seedAtCourse(playwright, { name: "Lesson Counts", codePrefix: "LESC" });
    try {
      const module = await seedModule(seeded.admin, seeded.atCourseId);
      await seedLesson(seeded.admin, module.id, { title: "Draft lesson one" });
      await seedLesson(seeded.admin, module.id, { title: "Draft lesson two" });

      await loginAsAdmin(page, "at-admin-lesson-counts");
      await gotoAiTutor(page, `/instructor/module/${module.id}`);

      await expect(page.getByText("Draft lesson one")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("Draft lesson two")).toBeVisible();
      await expect(page.getByText(/2 Lessons/i)).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor ADMIN — activities", () => {
  test("authors an MCQ activity end to end", async ({ page, playwright }) => {
    const seeded = await seedAtCourse(playwright, {
      name: "Activity Authoring",
      codePrefix: "ACTA",
      topics: ["Recursion", "Complexity"],
    });
    try {
      const module = await seedModule(seeded.admin, seeded.atCourseId);
      const lesson = await seedLesson(seeded.admin, module.id);

      await loginAsAdmin(page, "at-admin-add-activity");
      await gotoAiTutor(page, `/instructor/lesson/${lesson.id}`);
      await expect(page.getByText("No activities yet.")).toBeVisible({ timeout: 20_000 });

      await page
        .getByRole("button", { name: /add activity/i })
        .first()
        .click();
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog.getByRole("heading", { name: "Add activity" })).toBeVisible();

      await dialog.getByPlaceholder(/write the question/i).fill("Which case stops a recursion?");
      await dialog.getByPlaceholder("Option A").fill("The base case");
      await dialog.getByPlaceholder("Option B").fill("The recursive case");
      // The letter chip is how a correct choice is marked.
      await dialog.getByRole("button", { name: "Mark option A correct" }).click();
      await expect(dialog.getByRole("button", { name: "Option A (correct answer)" })).toBeVisible();

      // A main topic is mandatory; topics arrive from Core via sync-on-read.
      await dialog.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "Recursion", exact: true }).click();

      // The AI-mode section is what the tutor loop will offer the student, and
      // the hint is what "Guide me" leans on — both are part of authoring, not
      // decoration, so set them here rather than accepting the defaults.
      await expect(dialog.getByText("AI study buddy")).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Teach me" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(dialog.getByRole("button", { name: "Guide me" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await dialog.getByRole("button", { name: "Guide me" }).click();
      await expect(dialog.getByRole("button", { name: "Guide me" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await dialog.getByPlaceholder("Optional hint…").fill("Think about termination.");

      await dialog.getByRole("button", { name: /^add activity$/i }).click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });

      await expect(page.getByText("Which case stops a recursion?")).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText("MCQ").first()).toBeVisible();

      // The authored mode selection is what the activity actually carries.
      await expect(page.getByRole("button", { name: "Teach me", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByRole("button", { name: "Guide me", exact: true })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    } finally {
      await seeded.dispose();
    }
  });

  test("the add-activity dialog refuses to leave an activity with no AI mode", async ({
    page,
    playwright,
  }) => {
    // Same guard as the per-activity panel, enforced at authoring time so an
    // activity can never be created without a way for a student to use it.
    const seeded = await seedAtCourse(playwright, {
      name: "Activity Mode Guard",
      codePrefix: "ACMG",
      topics: ["Recursion"],
    });
    try {
      const module = await seedModule(seeded.admin, seeded.atCourseId);
      const lesson = await seedLesson(seeded.admin, module.id);

      await loginAsAdmin(page, "at-admin-activity-mode-guard");
      await gotoAiTutor(page, `/instructor/lesson/${lesson.id}`);
      await page
        .getByRole("button", { name: /add activity/i })
        .first()
        .click();

      const dialog = page.locator('[role="dialog"]');
      await dialog.getByRole("button", { name: "Guide me" }).click();
      await expect(dialog.getByRole("button", { name: "Guide me" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );

      // No native dialog should be raised at all — fail loudly if one is.
      const alerts: string[] = [];
      page.on("dialog", (d) => {
        alerts.push(d.message());
        void d.dismiss();
      });
      await dialog.getByRole("button", { name: "Teach me" }).click();

      // The refusal is inline, under the AI study buddy box in the dialog.
      await expect(dialog.getByText("At least one AI mode must be enabled.")).toBeVisible({
        timeout: 10_000,
      });
      expect(alerts).toEqual([]);
      await expect(dialog.getByRole("button", { name: "Teach me" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      // Re-enabling a mode clears it.
      await dialog.getByRole("button", { name: "Guide me" }).click();
      await expect(dialog.getByText("At least one AI mode must be enabled.")).toHaveCount(0);
    } finally {
      await seeded.dispose();
    }
  });

  test("requires a main topic before an activity can be created", async ({ page, playwright }) => {
    const seeded = await seedAtCourse(playwright, {
      name: "Activity Validation",
      codePrefix: "ACTV",
      topics: ["Recursion"],
    });
    try {
      const module = await seedModule(seeded.admin, seeded.atCourseId);
      const lesson = await seedLesson(seeded.admin, module.id);

      await loginAsAdmin(page, "at-admin-activity-validation");
      await gotoAiTutor(page, `/instructor/lesson/${lesson.id}`);
      await page
        .getByRole("button", { name: /add activity/i })
        .first()
        .click();

      const dialog = page.locator('[role="dialog"]');
      await dialog.getByPlaceholder(/write the question/i).fill("Unfinished question");
      await dialog.getByPlaceholder("Option A").fill("A");
      await dialog.getByPlaceholder("Option B").fill("B");
      // Marking a correct choice is a *separate* precondition that the submit
      // handler checks before the topic guard (it has its own persistent "No
      // correct answer selected yet." hint). Satisfy it so the missing main
      // topic is the only thing left blocking submission — otherwise this test
      // passes for the wrong reason, stopping at the earlier guard.
      await dialog.getByRole("button", { name: "Mark option A correct" }).click();
      await expect(dialog.getByRole("button", { name: "Option A (correct answer)" })).toBeVisible();

      await dialog.getByRole("button", { name: /^add activity$/i }).click();

      await expect(dialog.getByText("Select a main topic to continue.")).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText("No activities yet.")).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });

  test("the import-activity dialog lists a source picker", async ({ page, playwright }) => {
    const seeded = await seedAtCourse(playwright, {
      name: "Activity Import",
      codePrefix: "ACTI",
      topics: ["Recursion"],
    });
    try {
      const module = await seedModule(seeded.admin, seeded.atCourseId);
      const lesson = await seedLesson(seeded.admin, module.id);

      await loginAsAdmin(page, "at-admin-import-activity");
      await gotoAiTutor(page, `/instructor/lesson/${lesson.id}`);
      await page.getByRole("button", { name: /^import$/i }).click();

      const dialog = page.locator('[role="dialog"]');
      await expect(dialog.getByText("Import activity")).toBeVisible();
      await expect(
        dialog.getByText("Copy an activity from one of your other lessons into this lesson."),
      ).toBeVisible();
      await expect(dialog.getByText("Select an activity…")).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });

  test("a course with no Core topics is told where topics actually come from", async ({
    page,
    playwright,
  }) => {
    // Regression (BUG-5): the empty-topics hint used to say "Open the course
    // page and use Sync topics from EduAI Core" — a control AI Tutor does not
    // have (`CourseTopicsHeroAction` renders nothing for Core-linked courses,
    // which is all of them since #1072, and there is no sync endpoint).
    // Topics are Core-owned and arrive by sync-on-read, so the guidance now
    // points at Core itself.
    const seeded = await seedAtCourse(playwright, {
      name: "No Topics Authoring",
      codePrefix: "NOTP",
    });
    try {
      const module = await seedModule(seeded.admin, seeded.atCourseId);
      const lesson = await seedLesson(seeded.admin, module.id);

      await loginAsAdmin(page, "at-admin-no-topics");
      await gotoAiTutor(page, `/instructor/lesson/${lesson.id}`);
      await page
        .getByRole("button", { name: /add activity/i })
        .first()
        .click();

      const dialog = page.locator('[role="dialog"]');
      await expect(
        dialog.getByText("No topics on this course yet. Add some on EduAI Core, then try again."),
      ).toBeVisible({ timeout: 20_000 });

      // And it no longer names a control AI Tutor doesn't have.
      await expect(dialog.getByText(/sync topics from eduai/i)).toHaveCount(0);
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);
      await expect(page.getByRole("button", { name: /sync topics from eduai/i })).toHaveCount(0);
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor ADMIN — publish controls on content cards", () => {
  test("a module card's More options menu opens without navigating into the module", async ({
    page,
    playwright,
  }) => {
    // Publish, unpublish, edit, delete, and "move to position" all live behind
    // the card kebab, so this is the gateway to every content action.
    //
    // This was once filed as "the kebab navigates instead of opening" (BUG-3).
    // It didn't: `getByRole("button", { name: "More options" })` matched the
    // CARD, whose role is button and whose accessible name was computed from
    // its contents — the kebab's label included. `.first()` then picked the
    // card, and clicking a card navigates. The cards now carry an explicit
    // aria-label, and this test targets the trigger by its own label.
    const seeded = await seedAtCourse(playwright, {
      name: "Kebab Course",
      codePrefix: "KEBB",
      publish: true,
    });
    try {
      await seedModule(seeded.admin, seeded.atCourseId, { title: "Kebab module" });

      await loginAsAdmin(page, "at-admin-kebab");
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);
      await expect(page.getByText("Kebab module")).toBeVisible({ timeout: 20_000 });

      // The card names itself, so the kebab's label is unambiguous.
      await expect(page.getByRole("button", { name: "Module: Kebab module" })).toBeVisible();
      await page.locator('button[aria-label="More options"]').first().click();

      await expect(page.getByRole("menu")).toBeVisible({ timeout: 5_000 });
      await expect(page).toHaveURL(new RegExp(`/instructor/courses/${seeded.atCourseId}$`));
      await expect(page.getByRole("menuitem", { name: /^Publish module$/ })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: /^Edit module$/ })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: /^Delete module$/ })).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });

  test("a module card shows its publish state as read-only, next to the action menu", async ({
    page,
    playwright,
  }) => {
    // State and action are deliberately separate: the badge reports what
    // students can see, the kebab above carries the toggle.
    const seeded = await seedAtCourse(playwright, {
      name: "Publish State Course",
      codePrefix: "PSTA",
      publish: true,
    });
    try {
      const draft = await seedModule(seeded.admin, seeded.atCourseId, { title: "Draft module" });
      await seedModule(seeded.admin, seeded.atCourseId, {
        title: "Published module",
        publish: true,
      });

      await loginAsAdmin(page, "at-admin-publish-state");
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);

      const draftCard = page.locator('[role="button"]').filter({ hasText: "Draft module" }).first();
      const publishedCard = page
        .locator('[role="button"]')
        .filter({ hasText: "Published module" })
        .first();
      await expect(draftCard).toContainText("Draft", { timeout: 20_000 });
      await expect(publishedCard).toContainText("Published");

      // And the card still navigates into the module it names.
      await draftCard.click();
      await expect(page).toHaveURL(new RegExp(`/instructor/module/${draft.id}$`));
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor ADMIN — course lifecycle stays in Core", () => {
  test("the course list points at Core for course creation", async ({ page }) => {
    // `canCreateCourse()` is hard-`false` for every role: AI Tutor imports
    // courses, it does not create them. A fresh admin's list is empty until a
    // Core course exists, and the empty state says where to go.
    await loginAsAdmin(page, "at-admin-no-create");
    await gotoAiTutor(page, "/instructor");

    await expect(page.getByRole("button", { name: /new course|create course/i })).toHaveCount(0);
  });

  test("an unknown course id lands on the generic 404 inside the shell", async ({ page }) => {
    // Regression (BUG-6): this used to fall through to root.tsx's bare,
    // unstyled "Oops! An unexpected error occurred." with no shell and no way
    // back. The route now owns a boundary that renders the same generic 404 the
    // rest of the app uses, inside the app shell.
    await loginAsAdmin(page, "at-admin-missing-course");
    await page.goto(`${AI_TUTOR_URL}/instructor/courses/99999999`);

    await expect(page.getByText("404 — Page not found")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/An unexpected error occurred/i)).toHaveCount(0);
    // The shell is still there, and so is a way out.
    await page.getByRole("link", { name: /go to dashboard/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("a non-numeric course id is rejected the same way", async ({ page }) => {
    await loginAsAdmin(page, "at-admin-bad-course-id");
    await page.goto(`${AI_TUTOR_URL}/instructor/courses/not-a-number`);
    await expect(page.getByText("404 — Page not found")).toBeVisible({ timeout: 30_000 });
  });
});
