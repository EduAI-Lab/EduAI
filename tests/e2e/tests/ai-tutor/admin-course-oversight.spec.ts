/**
 * AI Tutor — ADMIN course-oversight workflows, driven through the browser.
 *
 * An admin uses the instructor shell (`nav.ts`: "admins get the same Courses
 * dashboard as instructors — admin ⊇ instructor"), but unscoped: every course
 * on the platform, including courses taught by someone else. This spec covers
 * the course list (search / status / term / pager), the four course-detail
 * tabs, and grading a student submission.
 *
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md`.
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_URL } from "../../playwright.config";
import { gotoAiTutor, loginAsAdmin, openTab } from "../helpers/at-ui";
import {
  atCourseTopicIds,
  seedAtCourse,
  seedLesson,
  seedMcqActivity,
  seedModule,
  seedStudentSubmission,
} from "../helpers/at-admin-fixtures";

test.describe("AI Tutor ADMIN — platform-wide course list", () => {
  test("an admin sees a course taught by another instructor", async ({ page, playwright }) => {
    const seeded = await seedAtCourse(playwright, {
      name: "Another Instructor's Course",
      codePrefix: "OTHER",
    });
    try {
      await loginAsAdmin(page, "at-admin-list-scope");
      await gotoAiTutor(page, "/instructor");

      await page.getByPlaceholder(/search courses/i).fill(seeded.code);
      await expect(page.getByText(seeded.name).first()).toBeVisible({ timeout: 20_000 });
      await expect(
        page.getByRole("link", { name: new RegExp(seeded.code) }).first(),
      ).toHaveAttribute("href", `/instructor/courses/${seeded.atCourseId}`);
    } finally {
      await seeded.dispose();
    }
  });

  test("search matches on title and on course code, and clears back", async ({
    page,
    playwright,
  }) => {
    const seeded = await seedAtCourse(playwright, {
      name: "Searchable Oversight Course",
      codePrefix: "SRCH",
    });
    try {
      await loginAsAdmin(page, "at-admin-list-search");
      await gotoAiTutor(page, "/instructor");
      const search = page.getByPlaceholder(/search courses/i);

      await search.fill("Searchable Oversight");
      await expect(page).toHaveURL(/search=Searchable/, { timeout: 20_000 });
      await expect(page.getByText(seeded.name).first()).toBeVisible();

      await search.fill(seeded.code);
      await expect(page.getByText(seeded.name).first()).toBeVisible({ timeout: 20_000 });

      await search.fill(`no-such-course-${Date.now()}`);
      await expect(page.getByText("No courses match")).toBeVisible({ timeout: 20_000 });
    } finally {
      await seeded.dispose();
    }
  });

  test("status and term filters narrow the list and Clear resets it", async ({
    page,
    playwright,
  }) => {
    const published = await seedAtCourse(playwright, {
      name: "Published Oversight Course",
      codePrefix: "PUBO",
      term: "W1",
      publish: true,
    });
    const draft = await seedAtCourse(playwright, {
      name: "Draft Oversight Course",
      codePrefix: "DRFO",
      term: "W2",
    });
    try {
      await loginAsAdmin(page, "at-admin-list-filters");
      await gotoAiTutor(page, "/instructor");

      await page.getByRole("combobox").filter({ hasText: "Status" }).click();
      await page.getByRole("option", { name: "Published", exact: true }).click();
      await expect(page).toHaveURL(/status=published/, { timeout: 20_000 });
      await expect(page.getByText(draft.name)).toHaveCount(0);

      await page
        .getByRole("button", { name: /^clear/i })
        .first()
        .click();
      await expect(page).not.toHaveURL(/status=published/, { timeout: 20_000 });

      await page.getByRole("combobox").filter({ hasText: "Term" }).click();
      await page.getByRole("option", { name: "2026W2", exact: true }).click();
      await expect(page).toHaveURL(/term=W2/, { timeout: 20_000 });
      await expect(page.getByText(draft.name).first()).toBeVisible();
      await expect(page.getByText(published.name)).toHaveCount(0);
    } finally {
      await published.dispose();
      await draft.dispose();
    }
  });

  test("the course list pages forward and back", async ({ page, playwright }) => {
    // #1208 made the list server-paged; only the past-the-end redirect was
    // covered, never an ordinary page turn.
    const seeded = await Promise.all(
      Array.from({ length: 13 }, (_, i) =>
        seedAtCourse(playwright, { name: `Paged Course ${i + 1}`, codePrefix: `PGD${i + 1}` }),
      ),
    );
    try {
      await loginAsAdmin(page, "at-admin-list-paging");
      await gotoAiTutor(page, "/instructor");

      const next = page.getByRole("button", { name: /next/i }).first();
      await expect(next).toBeEnabled({ timeout: 20_000 });
      await next.click();
      await expect(page).toHaveURL(/page=2/, { timeout: 20_000 });

      const previous = page.getByRole("button", { name: /previous/i }).first();
      await expect(previous).toBeEnabled();
      await previous.click();
      await expect(page).not.toHaveURL(/page=2/, { timeout: 20_000 });
      // Page 1 has nothing before it.
      await expect(page.getByRole("button", { name: /previous/i }).first()).toBeDisabled();
    } finally {
      await Promise.all(seeded.map((c) => c.dispose()));
    }
  });

  test("a hand-edited page number past the end is corrected instead of showing nothing", async ({
    page,
    playwright,
  }) => {
    // #1162: the loader redirects past-the-end pages so the URL and the rendered
    // list cannot disagree.
    const seeded = await seedAtCourse(playwright, { name: "Pager Course", codePrefix: "PAGE" });
    try {
      await loginAsAdmin(page, "at-admin-list-pager");
      await page.goto(`${AI_TUTOR_URL}/instructor?page=99`);
      await expect(page).not.toHaveURL(/page=99/, { timeout: 30_000 });
      await expect(page.getByText("Browse your courses and manage their content.")).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor ADMIN — course detail tabs", () => {
  test("all four staff tabs are available on someone else's course", async ({
    page,
    playwright,
  }) => {
    const seeded = await seedAtCourse(playwright, { name: "Tabs Course", codePrefix: "TABS" });
    try {
      await loginAsAdmin(page, "at-admin-tabs");
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);

      await expect(page.getByRole("heading", { name: seeded.name })).toBeVisible();
      for (const tab of ["Content", "Submissions", "Feedback", "Analytics"]) {
        await expect(page.getByRole("tab", { name: tab })).toBeVisible();
      }
    } finally {
      await seeded.dispose();
    }
  });

  test("the Feedback tab exposes its filters and an empty state", async ({ page, playwright }) => {
    const seeded = await seedAtCourse(playwright, { name: "Feedback Course", codePrefix: "FBK" });
    try {
      await loginAsAdmin(page, "at-admin-feedback");
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);
      await openTab(page, "Feedback");

      await expect(page.getByText("Student activity feedback in this course.")).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByRole("button", { name: /apply filters/i })).toBeVisible();
      await expect(page.getByText("No feedback yet.")).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });

  test("the Feedback filters are applied, validated, and cleared", async ({ page, playwright }) => {
    // The filters are raw id boxes — an admin has no way to look those ids up
    // from this page (recorded as a UI finding) — but they must at least apply,
    // reject nonsense, and clear.
    const seeded = await seedAtCourse(playwright, {
      name: "Feedback Filter Course",
      codePrefix: "FBKF",
    });
    try {
      await loginAsAdmin(page, "at-admin-feedback-apply");
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);
      await openTab(page, "Feedback");
      await expect(page.getByText("No feedback yet.")).toBeVisible({ timeout: 20_000 });

      // A non-numeric activity id is refused client-side rather than sent.
      await page.locator("#feedback-activity-id").fill("not-a-number");
      await page.getByRole("button", { name: /apply filters/i }).click();
      await expect(page.getByText("Activity ID must be a number.")).toBeVisible({
        timeout: 10_000,
      });

      // A well-formed filter is applied — it reaches the server as a query.
      const filtered = page.waitForRequest(
        (req) => req.url().includes("/feedback") && req.url().includes("activityId=4242"),
        { timeout: 20_000 },
      );
      await page.locator("#feedback-activity-id").fill("4242");
      await page.locator("#feedback-student-id").fill("some-student-id");
      await page.getByRole("button", { name: /apply filters/i }).click();
      await filtered;
      await expect(page.getByText("Activity ID must be a number.")).toHaveCount(0);

      await page.getByRole("button", { name: /^clear$/i }).click();
      await expect(page.locator("#feedback-activity-id")).toHaveValue("");
      await expect(page.locator("#feedback-student-id")).toHaveValue("");
    } finally {
      await seeded.dispose();
    }
  });

  test("the Analytics tab renders its rollups and an empty state", async ({ page, playwright }) => {
    const seeded = await seedAtCourse(playwright, { name: "Analytics Course", codePrefix: "ANL" });
    try {
      await loginAsAdmin(page, "at-admin-analytics");
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);
      await openTab(page, "Analytics");

      await expect(page.getByText("Activity analytics")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("Student metrics")).toBeVisible();
      await expect(page.getByText("No analytics recorded yet.")).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });

  test("the Submissions tab shows its counters and an empty state", async ({
    page,
    playwright,
  }) => {
    const seeded = await seedAtCourse(playwright, {
      name: "Submissions Course",
      codePrefix: "SUB",
    });
    try {
      await loginAsAdmin(page, "at-admin-submissions-empty");
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);
      await openTab(page, "Submissions");

      await expect(page.getByText("Student answer attempts in this course.")).toBeVisible({
        timeout: 20_000,
      });
      // The counter row is part of this panel, not decoration — assert it.
      for (const label of ["Submissions", "Needs grading", "Correct", "Pass rate"]) {
        await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
      }
      await expect(page.getByText("No submissions yet.")).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor ADMIN — grading a student submission", () => {
  test("an admin grades another instructor's student and the counters follow", async ({
    page,
    playwright,
  }) => {
    const seeded = await seedAtCourse(playwright, {
      name: "Graded Oversight Course",
      codePrefix: "GRD",
      topics: ["Recursion"],
      publish: true,
    });
    try {
      const module = await seedModule(seeded.admin, seeded.atCourseId, { publish: true });
      const lesson = await seedLesson(seeded.admin, module.id, { publish: true });
      const [topicId] = await atCourseTopicIds(seeded.admin, seeded.atCourseId);
      const activity = await seedMcqActivity(seeded.admin, lesson.id, topicId);
      await seedStudentSubmission(playwright, seeded, activity.id, { answerOption: 1 });

      await loginAsAdmin(page, "at-admin-grading");
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);
      await openTab(page, "Submissions");

      // The MCQ carries a correct answer, so the submission arrives already
      // auto-evaluated. The student picked option B; option A is correct.
      const card = page.locator('[data-testid="submission-card"]').first();
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card).toContainText("Incorrect");
      await expect(card).toContainText(activity.question);

      await card.click();
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible();
      // Label text is uppercased in CSS, so match the DOM casing.
      await expect(dialog.getByText(/override grade/i)).toBeVisible();

      await dialog.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "Correct", exact: true }).click();
      await dialog.getByPlaceholder(/leave blank/i).fill("5");
      await dialog.getByRole("button", { name: /save grade/i }).click();

      await expect(dialog).toBeHidden({ timeout: 20_000 });
      const graded = page.locator('[data-testid="submission-card"]').first();
      await expect(graded).toContainText("Correct", { timeout: 20_000 });
      await expect(graded).toContainText("Score 5");

      // "the counters follow" is the claim, so assert them: the override flips
      // the machine's Incorrect to Correct and the pass rate with it.
      const panel = page.locator('[data-testid="course-submissions-panel"]');
      const tile = (label: string, value: string) =>
        panel
          .locator("div")
          .filter({ hasText: new RegExp(`^${label}${value}$`) })
          .first();
      await expect(tile("Correct", "1")).toBeVisible({ timeout: 20_000 });
      await expect(tile("Pass rate", "100%")).toBeVisible();

      // The override is persisted, not just optimistic local state.
      await page.reload();
      await openTab(page, "Submissions");
      await expect(page.locator('[data-testid="submission-card"]').first()).toContainText(
        "Correct",
        { timeout: 30_000 },
      );
    } finally {
      await seeded.dispose();
    }
  });

  test("the submissions list can be filtered by result and searched", async ({
    page,
    playwright,
  }) => {
    const seeded = await seedAtCourse(playwright, {
      name: "Submission Filters Course",
      codePrefix: "SFIL",
      topics: ["Recursion"],
      publish: true,
    });
    try {
      const module = await seedModule(seeded.admin, seeded.atCourseId, { publish: true });
      const lesson = await seedLesson(seeded.admin, module.id, { publish: true });
      const [topicId] = await atCourseTopicIds(seeded.admin, seeded.atCourseId);
      const activity = await seedMcqActivity(seeded.admin, lesson.id, topicId);
      await seedStudentSubmission(playwright, seeded, activity.id, { answerOption: 1 });

      await loginAsAdmin(page, "at-admin-submission-filters");
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);
      await openTab(page, "Submissions");
      await expect(page.locator('[data-testid="submission-card"]').first()).toBeVisible({
        timeout: 30_000,
      });

      // The result filter is a radio group, not a set of buttons.
      const filters = page.getByRole("radiogroup", { name: /filter submissions by result/i });
      await expect(filters).toBeVisible();
      // The seeded answer is auto-evaluated as wrong, so "Correct" is empty and
      // "Incorrect" holds it. "Correct" must be exact — "Incorrect" contains it.
      await filters.getByRole("radio", { name: "Correct", exact: true }).click();
      await expect(page.getByText("No submissions match this filter.")).toBeVisible({
        timeout: 20_000,
      });
      await filters.getByRole("radio", { name: "Incorrect", exact: true }).click();
      await expect(page.locator('[data-testid="submission-card"]').first()).toBeVisible({
        timeout: 20_000,
      });

      // Both view densities render the same submission.
      await page.getByRole("button", { name: "Extended view" }).click();
      await expect(page.locator('[data-testid="submission-card"]').first()).toBeVisible();
      await page.getByRole("button", { name: "Grid view" }).click();
      await expect(page.locator('[data-testid="submission-card"]').first()).toBeVisible();

      await page.getByLabel("Search submissions").fill(`no-match-${Date.now()}`);
      await expect(page.getByText("No submissions match this filter.")).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await seeded.dispose();
    }
  });

  test("a grade can be cleared back to Not graded", async ({ page, playwright }) => {
    // Regression (BUG-1): the dialog used to OMIT `isCorrect` when the result
    // was "ungraded" and `score` when blank, so Save posted `{}` and the
    // server answered 400 "Nothing to update" — a grade could not be taken
    // back at all. Both fields are now sent explicitly, `null` meaning clear.
    const seeded = await seedAtCourse(playwright, {
      name: "Ungraded Save Course",
      codePrefix: "UNGR",
      topics: ["Recursion"],
      publish: true,
    });
    try {
      const module = await seedModule(seeded.admin, seeded.atCourseId, { publish: true });
      const lesson = await seedLesson(seeded.admin, module.id, { publish: true });
      const [topicId] = await atCourseTopicIds(seeded.admin, seeded.atCourseId);
      const activity = await seedMcqActivity(seeded.admin, lesson.id, topicId);
      await seedStudentSubmission(playwright, seeded, activity.id, { answerOption: 1 });

      await loginAsAdmin(page, "at-admin-ungraded");
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);
      await openTab(page, "Submissions");
      await expect(page.locator('[data-testid="submission-card"]').first()).toBeVisible({
        timeout: 30_000,
      });

      // First put a grade on it, so clearing is a real state change.
      await page.locator('[data-testid="submission-card"]').first().click();
      const dialog = page.locator('[role="dialog"]');
      await dialog.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "Correct", exact: true }).click();
      await dialog.getByPlaceholder(/leave blank/i).fill("5");
      await dialog.getByRole("button", { name: /save grade/i }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });

      // Now take it back: Result → Not graded, score cleared.
      await page.locator('[data-testid="submission-card"]').first().click();
      await dialog.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "Not graded", exact: true }).click();
      await dialog.getByPlaceholder(/leave blank/i).fill("");
      await dialog.getByRole("button", { name: /save grade/i }).click();

      // Intended behaviour: the override is removed and the dialog closes.
      await expect(dialog.getByText(/Could not save the grade/i)).toHaveCount(0, {
        timeout: 10_000,
      });
      await expect(dialog).toBeHidden({ timeout: 10_000 });
    } finally {
      await seeded.dispose();
    }
  });

  test("Analytics accuracy follows a manually overridden grade", async ({ page, playwright }) => {
    // Regression (BUG-8): the Analytics rollups read `ActivityStudentMetric`,
    // whose counters used to be written once, at submit time. A manual
    // override touched only the `Submission` row, so Analytics kept reporting
    // Accuracy 0% while the Submissions tab read 100% for the same course.
    // The PATCH route now re-derives that student's counters from their
    // submissions (`resyncSubmissionMetrics`).
    const seeded = await seedAtCourse(playwright, {
      name: "Analytics Override Course",
      codePrefix: "AOVR",
      topics: ["Recursion"],
      publish: true,
    });
    try {
      const module = await seedModule(seeded.admin, seeded.atCourseId, { publish: true });
      const lesson = await seedLesson(seeded.admin, module.id, { publish: true });
      const [topicId] = await atCourseTopicIds(seeded.admin, seeded.atCourseId);
      const activity = await seedMcqActivity(seeded.admin, lesson.id, topicId);
      await seedStudentSubmission(playwright, seeded, activity.id, { answerOption: 1 });

      await loginAsAdmin(page, "at-admin-analytics-override");
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);
      await openTab(page, "Submissions");
      await page.locator('[data-testid="submission-card"]').first().click();
      const dialog = page.locator('[role="dialog"]');
      await dialog.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "Correct", exact: true }).click();
      await dialog.getByRole("button", { name: /save grade/i }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });

      await openTab(page, "Analytics");
      const analytics = page.locator('[data-testid="course-analytics-panel"]');
      await expect(analytics.getByText("Overall accuracy")).toBeVisible({ timeout: 20_000 });

      // Pin the Accuracy stat tile specifically. A bare "100%" also matches
      // the difficulty-mix legend, which is what made the previous version of
      // this test pass while accuracy actually read 0%.
      await expect(analytics.getByText("Accuracy", { exact: true })).toBeVisible();
      await expect(
        analytics
          .locator("div")
          .filter({ hasText: /^Accuracy100%$/ })
          .first(),
      ).toBeVisible({ timeout: 20_000 });
    } finally {
      await seeded.dispose();
    }
  });

  test("Student metrics names the student instead of printing their user id", async ({
    page,
    playwright,
  }) => {
    // Regression (BUG-2): the per-student table used to render the raw Core
    // user id (e.g. "Tqvu5puYWcO5ezBfxNRjRD5rWCyRBbFn") while the Submissions
    // tab resolved the same person's display name. `GET .../student-metrics`
    // now resolves names the same way the submissions route does.
    const seeded = await seedAtCourse(playwright, {
      // Deliberately NOT named "Student metrics …": `getByText` is a
      // case-insensitive substring match, so a course title containing the
      // panel heading makes the assertion below a strict-mode violation and
      // the test would "pass" as test.fail without ever reaching the point.
      name: "Per-Learner Rollup Course",
      codePrefix: "SMET",
      topics: ["Recursion"],
      publish: true,
    });
    try {
      const module = await seedModule(seeded.admin, seeded.atCourseId, { publish: true });
      const lesson = await seedLesson(seeded.admin, module.id, { publish: true });
      const [topicId] = await atCourseTopicIds(seeded.admin, seeded.atCourseId);
      const activity = await seedMcqActivity(seeded.admin, lesson.id, topicId);
      const student = await seedStudentSubmission(playwright, seeded, activity.id);

      await loginAsAdmin(page, "at-admin-metrics-name");
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);
      await openTab(page, "Analytics");

      // `CardTitle` renders a div, not a heading — and the course is
      // deliberately not named after the panel, so this text is unambiguous.
      await expect(page.getByText("Student metrics", { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      // The cell holds the name the Submissions tab resolves for the same
      // person, not the raw Core user id.
      await expect(page.getByRole("cell", { name: student.studentName })).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await seeded.dispose();
    }
  });
});
