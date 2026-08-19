/**
 * Question Maker all-role end-user workflows (#1429, #1530).
 *
 * The suite drives the real QM browser UI. AI is mocked at the QM proxy
 * boundary so the generation workflow remains deterministic and does not
 * spend a live provider request during CI.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { CORE_URL, QM_FRONTEND_URL } from "../../playwright.config";
import {
  createAdmin,
  createInstructor,
  promoteUser,
  registerUser,
  signInThroughPage,
} from "../helpers/auth";
import { createQmCourseForInstructor } from "../helpers/qm-courses";

async function createUnitAdmin(
  request: APIRequestContext,
): Promise<{ email: string; password: string; name: string }> {
  const user = await registerUser(request, { prefix: "qm-unit-admin", name: "E2E Unit Admin" });
  await promoteUser(request, user.email, "UNIT_ADMIN");
  return user;
}

async function getMyId(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${CORE_URL}/api/me`);
  expect(response.status()).toBe(200);
  return (await response.json()).id;
}

test.describe("Question Maker role access", () => {
  test("STUDENT sees a clear access boundary instead of the authoring app", async ({
    page,
    request,
  }) => {
    const student = await registerUser(request, { prefix: "qm-ui-student" });
    await signInThroughPage(page, student, `${QM_FRONTEND_URL}/dashboard`);

    await expect(page.getByText("Access restricted", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Question Maker is available to instructors and administrators.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Question Library" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Back to EduAI" })).toBeVisible();
  });

  test("TA enrollment follows the same explicit access boundary as a Student platform account", async ({
    page,
    playwright,
  }) => {
    const adminContext = await playwright.request.newContext();
    const instructorContext = await playwright.request.newContext();
    const taContext = await playwright.request.newContext();

    try {
      await createAdmin(adminContext, { prefix: "qm-ta-course-admin" });
      await createInstructor(instructorContext, { prefix: "qm-ta-course-instructor" });
      const ta = await registerUser(taContext, { prefix: "qm-ui-ta" });

      const taId = await getMyId(taContext);
      const { coreCourseId } = await createQmCourseForInstructor(playwright, instructorContext, {
        name: "QM TA Access Boundary",
        code: "QM-TA-ACCESS",
      });

      const enrollment = await adminContext.post(
        `${CORE_URL}/api/courses/${coreCourseId}/enrollments`,
        {
          data: { userId: taId, role: "TA" },
        },
      );
      expect(enrollment.status()).toBe(201);

      await signInThroughPage(page, ta, `${QM_FRONTEND_URL}/dashboard`);

      await expect(page.getByText("Access restricted", { exact: true })).toBeVisible();
      await expect(
        page.getByText("teaching assistants should use EduAI Core or AI Tutor", { exact: false }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "Back to EduAI" })).toBeVisible();
    } finally {
      await adminContext.dispose();
      await instructorContext.dispose();
      await taContext.dispose();
    }
  });
});

test.describe("Question Maker authoring and AI workflows", () => {
  test("INSTRUCTOR can open the AI composer and review a generated question before saving", async ({
    page,
    playwright,
  }) => {
    const instructorContext = await playwright.request.newContext();

    try {
      const instructor = await createInstructor(instructorContext, { prefix: "qm-ui-instructor" });
      const { qmCourseId } = await createQmCourseForInstructor(playwright, instructorContext, {
        name: "QM Instructor AI Workflow",
        code: "QM-INSTR-AI",
      });

      await page.route("**/api/eduai/generate-questions", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            data: {
              questions: [
                {
                  content: "Which data structure uses FIFO ordering?",
                  description: "FIFO data structure",
                  difficulty: "easy",
                  reasoning_level: "factual",
                  bloom_level: "remember",
                  type: "MCQ",
                  answer: "A",
                  choices: [
                    { letter: "A", text: "Queue" },
                    { letter: "B", text: "Stack" },
                    { letter: "C", text: "Heap" },
                    { letter: "D", text: "Tree" },
                  ],
                  primary_topic_id: 1,
                },
              ],
              count: 1,
              course: { id: qmCourseId, name: "QM Instructor AI Workflow", code: "QM-INSTR-AI" },
            },
          }),
        });
      });

      await signInThroughPage(
        page,
        instructor,
        `${QM_FRONTEND_URL}/courses/${qmCourseId}/questions/new`,
      );
      const prompt = page.getByRole("textbox", { name: "Prompt" });
      await expect(prompt).toBeVisible();
      await prompt.fill("FIFO data structures");
      await page.getByRole("button", { name: "Generate question" }).click();

      await expect(page.locator("#composer-variant-text")).toHaveValue(
        "Which data structure uses FIFO ordering?",
        { timeout: 15_000 },
      );
      await expect(page.getByRole("textbox", { name: "Option A" })).toHaveValue("Queue");
      await expect(page.getByRole("checkbox", { name: /Mark as reviewed/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "Save question" })).toBeEnabled();
    } finally {
      await instructorContext.dispose();
    }
  });

  test("UNIT_ADMIN can enter the QM app but cannot triage platform bug reports", async ({
    page,
    request,
  }) => {
    const unitAdmin = await createUnitAdmin(request);
    await signInThroughPage(page, unitAdmin, `${QM_FRONTEND_URL}/dashboard`);
    const sidebar = page.locator("#app-sidebar-content");
    await expect(sidebar.getByRole("link", { name: "Courses" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Question Library" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Bug reports" })).toHaveCount(0);
  });

  test("ADMIN sees the full authoring navigation including bug-report triage", async ({
    page,
    request,
  }) => {
    const admin = await createAdmin(request, { prefix: "qm-ui-admin" });
    await signInThroughPage(page, admin, `${QM_FRONTEND_URL}/dashboard`);
    const sidebar = page.locator("#app-sidebar-content");
    await expect(sidebar.getByRole("link", { name: "Courses" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Question Library" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Bug reports" })).toBeVisible();
  });
});
