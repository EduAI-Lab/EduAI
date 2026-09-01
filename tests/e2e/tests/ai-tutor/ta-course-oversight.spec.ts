/**
 * AI Tutor — TA course oversight in the instructor shell, through the browser.
 *
 * A TA reaches `/instructor/*` (`usesInstructorShell`) but is NOT a content
 * manager: `canManageContent` is false for a TA, while `canViewCourseSubmissions
 * / Feedback / Analytics` are all true. So a TA opens the same course detail an
 * instructor does — Content, Submissions, Feedback, Analytics — but the Content
 * tab is read-only (no authoring affordances) and the value is in the oversight
 * tabs. A TA can only reach a course they actually assist: a course they have no
 * TA enrolment on is a 404 in the shell and a 403 at the API.
 *
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md` (TA).
 */
import { test, expect, type Page } from "@playwright/test";
import { AI_TUTOR_API_URL, AI_TUTOR_URL } from "../../playwright.config";
import { gotoAiTutor, openTab } from "../helpers/at-ui";
import { registerStudent, seedPublishedCourseAndEnroll } from "../helpers/at-student-fixtures";
import { seedAtCourse, seedModule, seedLesson } from "../helpers/at-admin-fixtures";

type Pw = { request: { newContext: () => Promise<import("@playwright/test").APIRequestContext> } };

async function seedTaCourse(page: Page, playwright: Pw, codePrefix = "TOV") {
  const { studentId } = await registerStudent(page);
  const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
    name: "TA Oversight Course",
    codePrefix,
    role: "TA",
  });
  return { studentId, seeded };
}

test.describe("AI Tutor TA — staff course list and detail", () => {
  test("the instructor course list shows a course the TA assists", async ({ page, playwright }) => {
    const { seeded } = await seedTaCourse(page, playwright, "TL1");
    try {
      await gotoAiTutor(page, "/instructor");
      await expect(page.getByRole("heading", { name: "Courses" }).first()).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByRole("link", { name: new RegExp(seeded.name) }).first()).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });

  test("opening a course shows all four staff tabs", async ({ page, playwright }) => {
    const { seeded } = await seedTaCourse(page, playwright, "TL2");
    try {
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);
      for (const label of ["Content", "Submissions", "Feedback", "Analytics"]) {
        await expect(page.getByRole("tab", { name: label })).toBeVisible({ timeout: 20_000 });
      }
    } finally {
      await seeded.dispose();
    }
  });

  test("the Content tab is read-only — a TA cannot author or create", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTaCourse(page, playwright, "TL3");
    try {
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);
      // The published module is visible (a TA sees content, including unpublished
      // drafts other learners cannot), ...
      await expect(page.getByText("Spine module")).toBeVisible({ timeout: 20_000 });
      // ... but `canManageContent` is false, so no authoring affordance renders.
      await expect(page.getByRole("button", { name: /add module/i })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /import modules/i })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /create course/i })).toHaveCount(0);
    } finally {
      await seeded.dispose();
    }
  });

  test("the Feedback tab renders its heading and id filters", async ({ page, playwright }) => {
    const { seeded } = await seedTaCourse(page, playwright, "TL4");
    try {
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);
      await openTab(page, "Feedback");
      await expect(page.getByText("Student activity feedback in this course.")).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText("Activity ID")).toBeVisible();
      await expect(page.getByText("Student ID")).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });

  test("the Analytics tab renders its rollups", async ({ page, playwright }) => {
    const { seeded } = await seedTaCourse(page, playwright, "TL5");
    try {
      await gotoAiTutor(page, `/instructor/courses/${seeded.atCourseId}`);
      await openTab(page, "Analytics");
      await expect(page.getByText("Overall accuracy")).toBeVisible({ timeout: 20_000 });
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor TA — a course the TA does not assist", () => {
  test("is a 404 in the shell and a 403 at the API", async ({ page, playwright }) => {
    // The TA is enrolled on their own course, but this one they have no
    // relation to at all.
    const { seeded: mine } = await seedTaCourse(page, playwright, "TF1");
    const foreign = await seedAtCourse(playwright, {
      name: "Foreign Course",
      codePrefix: "FGN",
      topics: ["Trees"],
      publish: true,
    });
    const mod = await seedModule(foreign.admin, foreign.atCourseId, { title: "Fm", publish: true });
    await seedLesson(foreign.admin, mod.id, { title: "Fl", publish: true });
    try {
      await page.goto(`${AI_TUTOR_URL}/instructor/courses/${foreign.atCourseId}`);
      await expect(page.getByText("404 — Page not found")).toBeVisible({ timeout: 30_000 });

      // The enrolment gate is enforced server-side, not just in the UI.
      const detail = await page.request.get(
        `${AI_TUTOR_API_URL}/api/courses/${foreign.atCourseId}`,
      );
      expect(detail.status()).toBe(403);
      const subs = await page.request.get(
        `${AI_TUTOR_API_URL}/api/courses/${foreign.atCourseId}/submissions`,
      );
      expect(subs.status()).toBe(403);
    } finally {
      await mine.dispose();
      await foreign.dispose();
    }
  });
});
