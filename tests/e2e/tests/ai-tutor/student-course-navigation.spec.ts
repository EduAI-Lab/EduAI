/**
 * AI Tutor — STUDENT course → module → lesson navigation, driven through the
 * browser.
 *
 * Covers the drill-down a student walks to reach an activity: the course hero +
 * module grid (`/student/courses/:id`), the module hero + lesson grid
 * (`/student/module/:id`), the breadcrumb course switcher, the empty states at
 * each level, and the in-shell 404 for a bad/unenrolled id.
 *
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md`.
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_API_URL, AI_TUTOR_URL } from "../../playwright.config";
import { gotoAiTutor, loginAsStudent } from "../helpers/at-ui";
import { seedAtCourse, seedCourseWithActivity } from "../helpers/at-admin-fixtures";
import {
  enrollStudent,
  registerStudent,
  seedPublishedCourseAndEnroll,
} from "../helpers/at-student-fixtures";

test.describe("AI Tutor STUDENT — course → module → lesson drill-down", () => {
  test("opens a course, its module, and its lesson in sequence", async ({ page, playwright }) => {
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Drilldown Course",
      codePrefix: "DRL",
    });
    try {
      await gotoAiTutor(page, `/student/courses/${seeded.atCourseId}`);
      await expect(page.getByRole("heading", { name: "Drilldown Course" })).toBeVisible({
        timeout: 20_000,
      });
      // Module grid → open the module.
      await page.getByText("Spine module").first().click();
      await expect(page).toHaveURL(new RegExp(`/student/module/${seeded.moduleId}$`), {
        timeout: 20_000,
      });

      // Lesson grid → open the lesson.
      await page.getByText("Spine lesson").first().click();
      await expect(page).toHaveURL(new RegExp(`/student/lesson/${seeded.lessonId}$`), {
        timeout: 20_000,
      });
      // The lesson player is up.
      await expect(page.getByText("Your answer")).toBeVisible({ timeout: 20_000 });
    } finally {
      await seeded.dispose();
    }
  });

  test("the course hero shows the module count and topics", async ({ page, playwright }) => {
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Hero Course",
      codePrefix: "HRO",
      topics: ["Recursion", "Complexity"],
    });
    try {
      await gotoAiTutor(page, `/student/courses/${seeded.atCourseId}`);
      await expect(page.getByText(/1 module/i).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("Recursion").first()).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor STUDENT — empty states", () => {
  test("a course with no modules shows the 'No modules available' state", async ({
    page,
    playwright,
  }) => {
    const { studentId } = await registerStudent(page);
    const seeded = await seedAtCourse(playwright, {
      name: "No Modules Course",
      codePrefix: "NMOD",
      publish: true,
    });
    try {
      await enrollStudent(seeded, studentId);
      await gotoAiTutor(page, `/student/courses/${seeded.atCourseId}`);
      await expect(page.getByText(/No modules available/i)).toBeVisible({ timeout: 20_000 });
    } finally {
      await seeded.dispose();
    }
  });

  test("a module with no lessons shows the 'No lessons available' state", async ({
    page,
    playwright,
  }) => {
    const { studentId } = await registerStudent(page);
    const seeded = await seedAtCourse(playwright, {
      name: "No Lessons Course",
      codePrefix: "NLES",
      publish: true,
    });
    try {
      await enrollStudent(seeded, studentId);
      // A published module with zero lessons.
      const mod = await (
        await seeded.admin.post(`${AI_TUTOR_API_URL}/api/courses/${seeded.atCourseId}/modules`, {
          data: { title: "Empty Module" },
        })
      ).json();
      await seeded.admin.patch(`${AI_TUTOR_API_URL}/api/modules/${mod.id}/publish`);

      await gotoAiTutor(page, `/student/module/${mod.id}`);
      await expect(page.getByText(/No lessons available/i)).toBeVisible({ timeout: 20_000 });
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor STUDENT — not-found handling", () => {
  for (const [label, path] of [
    ["non-numeric course id", "/student/courses/not-a-number"],
    ["nonexistent course id", "/student/courses/99999999"],
    ["nonexistent module id", "/student/module/99999999"],
    ["nonexistent lesson id", "/student/lesson/99999999"],
  ] as const) {
    test(`${label} lands on the in-shell 404`, async ({ page }) => {
      await loginAsStudent(page, "at-student-nav-404");
      await page.goto(`${AI_TUTOR_URL}${path}`);
      await expect(page.getByText("404 — Page not found")).toBeVisible({ timeout: 30_000 });
      await expect(
        page.getByRole("link", { name: "Dashboard", exact: true }).first(),
      ).toBeVisible();
    });
  }

  test("a course the student is not enrolled in is a 404, not a peek", async ({
    page,
    playwright,
  }) => {
    // Security: an enrolment-gated course must answer a non-member with the same
    // 404 as a missing one, never confirming the course exists.
    await loginAsStudent(page, "at-student-nav-gate");
    const seeded = await seedCourseWithActivity(playwright, {
      name: "Gated Course",
      codePrefix: "GAT",
      publish: true,
    });
    try {
      await page.goto(`${AI_TUTOR_URL}/student/courses/${seeded.atCourseId}`);
      await expect(page.getByText("404 — Page not found")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("heading", { name: "Gated Course" })).toHaveCount(0);
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor STUDENT — breadcrumb course switcher", () => {
  test("switches between two enrolled courses without returning to the list", async ({
    page,
    playwright,
  }) => {
    const { studentId } = await registerStudent(page);
    const stamp = Date.now();
    const first = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: `Student Switcher One ${stamp}`,
      codePrefix: "SSA",
    });
    const second = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: `Student Switcher Two ${stamp}`,
      codePrefix: "SSB",
    });
    try {
      await gotoAiTutor(page, `/student/courses/${first.atCourseId}`);
      await expect(page.getByRole("heading", { name: first.name })).toBeVisible({
        timeout: 20_000,
      });

      await page.getByRole("button", { name: "Switch course" }).click();
      await page.getByRole("searchbox").fill(second.name);
      const option = page.getByRole("menuitem").filter({ hasText: String(stamp) });
      await expect(option).toHaveCount(1, { timeout: 20_000 });
      await option.click();

      await expect(page).toHaveURL(new RegExp(`/student/courses/${second.atCourseId}$`), {
        timeout: 20_000,
      });
      await expect(page.getByRole("heading", { name: second.name })).toBeVisible();
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });
});
