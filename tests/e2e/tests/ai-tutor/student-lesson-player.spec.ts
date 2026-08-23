/**
 * AI Tutor — STUDENT lesson player (`/student/lesson/:id`), driven through the
 * browser. This is the flagship student surface: the question card, the answer
 * card, MCQ/short-text submission, the immediate result, the post-submission
 * feedback prompt, the Guide-me hand-off, and the prev/next activity walk.
 *
 * The AI study buddy itself is covered in `student-ai-chat.spec.ts` — in the
 * e2e stack it has no model provider, so its answer path is out of scope here.
 *
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md`.
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_API_URL } from "../../playwright.config";
import { gotoAiTutor } from "../helpers/at-ui";
import { seedMcqActivity } from "../helpers/at-admin-fixtures";
import { registerStudent, seedPublishedCourseAndEnroll } from "../helpers/at-student-fixtures";

test.describe("AI Tutor STUDENT — lesson player layout", () => {
  test("renders the question card, answer card, and study-buddy panel", async ({
    page,
    playwright,
  }) => {
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Player Layout Course",
      codePrefix: "PLC",
      question: "Which case stops a recursion?",
    });
    try {
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      await expect(page.getByText("Which case stops a recursion?")).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText(/Question 1 of 1/i).first()).toBeVisible();
      await expect(page.getByText("Your answer")).toBeVisible();
      await expect(page.getByText("AI study buddy")).toBeVisible();
      await expect(page.getByRole("button", { name: /submit answer/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /guide me/i })).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor STUDENT — answering an MCQ", () => {
  test("Submit is disabled until a choice is selected", async ({ page, playwright }) => {
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Submit Gate Course",
      codePrefix: "SGC",
    });
    try {
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      const submit = page.getByRole("button", { name: /submit answer/i });
      await expect(submit).toBeDisabled();
      await page.getByRole("radio").first().click();
      await expect(submit).toBeEnabled();
    } finally {
      await seeded.dispose();
    }
  });

  test("a correct answer shows 'Correct!' and locks the options", async ({ page, playwright }) => {
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Correct Answer Course",
      codePrefix: "CAC",
    });
    try {
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      // Seed default: options ["The base case", "The recursive case"], correct = A.
      await page.getByRole("radio", { name: "Option A" }).click();
      await page.getByRole("button", { name: /submit answer/i }).click();

      await expect(page.getByText("Correct!")).toBeVisible({ timeout: 20_000 });
      // After a correct answer both the options and Guide-me lock.
      await expect(page.getByRole("radio").first()).toBeDisabled();
      await expect(page.getByRole("button", { name: /guide me/i })).toBeDisabled();
    } finally {
      await seeded.dispose();
    }
  });

  test("a wrong answer shows 'Not quite. Keep going!'", async ({ page, playwright }) => {
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Wrong Answer Course",
      codePrefix: "WAC",
    });
    try {
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      await page.getByRole("radio", { name: "Option B" }).click();
      await page.getByRole("button", { name: /submit answer/i }).click();

      await expect(page.getByText(/Not quite\. Keep going!/i)).toBeVisible({ timeout: 20_000 });
      // Guide-me stays available after a wrong answer.
      await expect(page.getByRole("button", { name: /guide me/i })).toBeEnabled();
    } finally {
      await seeded.dispose();
    }
  });

  test("the post-submission feedback prompt rates and thanks the student", async ({
    page,
    playwright,
  }) => {
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Feedback Prompt Course",
      codePrefix: "FPC",
    });
    try {
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      await page.getByRole("radio", { name: "Option A" }).click();
      await page.getByRole("button", { name: /submit answer/i }).click();
      await expect(page.getByText("Correct!")).toBeVisible({ timeout: 20_000 });

      const prompt = page.getByText("Quick feedback");
      await expect(prompt).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: "3", exact: true }).click();
      await page.getByRole("button", { name: /send feedback/i }).click();
      await expect(page.getByText(/Thanks for the feedback/i)).toBeVisible({ timeout: 20_000 });
    } finally {
      await seeded.dispose();
    }
  });

  test("dismiss the feedback prompt with 'Maybe later' instead of rating", async ({
    page,
    playwright,
  }) => {
    // The feedback card renders after the first attempt
    // (`promptShown && !dismissed`); "Maybe later" calls `onDismiss`, which sets
    // `dismissed` and hides the card without a rating — no thanks confirmation,
    // just gone.
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Feedback Dismiss Course",
      codePrefix: "FDC",
    });
    try {
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      await page.getByRole("radio", { name: "Option A" }).click();
      await page.getByRole("button", { name: /submit answer/i }).click();
      await expect(page.getByText("Correct!")).toBeVisible({ timeout: 20_000 });

      await expect(page.getByText("Quick feedback")).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: /maybe later/i }).click();

      // Dismissed: neither the prompt nor a "thanks" confirmation remains.
      await expect(page.getByText("Quick feedback")).toHaveCount(0);
      await expect(page.getByText(/Thanks for the feedback/i)).toHaveCount(0);
    } finally {
      await seeded.dispose();
    }
  });

  test("recover from a wrong answer: re-pick a different option and reach 'Correct!'", async ({
    page,
    playwright,
  }) => {
    // Options stay enabled after a wrong answer (`disabled={submitting ||
    // wasCorrect}`), so the student can re-pick and re-submit; each submit is a
    // fresh `POST /questions/:id/answer`. The recovery path ends on "Correct!"
    // and only then do the options lock.
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Wrong Answer Recovery Course",
      codePrefix: "WRC",
    });
    try {
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);

      // First attempt is wrong (correct answer is Option A).
      await page.getByRole("radio", { name: "Option B" }).click();
      await page.getByRole("button", { name: /submit answer/i }).click();
      await expect(page.getByText(/Not quite\. Keep going!/i)).toBeVisible({ timeout: 20_000 });
      // The options are still live — a wrong answer does not lock the card.
      await expect(page.getByRole("radio", { name: "Option A" })).toBeEnabled();

      // Re-pick the correct option and re-submit.
      await page.getByRole("radio", { name: "Option A" }).click();
      await page.getByRole("button", { name: /submit answer/i }).click();

      await expect(page.getByText("Correct!")).toBeVisible({ timeout: 20_000 });
      // Now the recovery is complete: the options lock.
      await expect(page.getByRole("radio").first()).toBeDisabled();
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor STUDENT — short-text activity", () => {
  test("a student can type and submit a short-text answer", async ({ page, playwright }) => {
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Short Text Course",
      codePrefix: "STC",
    });
    try {
      // Add a SHORT_TEXT activity after the seeded MCQ.
      const res = await seeded.admin.post(
        `${AI_TUTOR_API_URL}/api/lessons/${seeded.lessonId}/activities`,
        {
          data: {
            question: "Name the case that stops a recursion.",
            type: "SHORT_TEXT",
            answer: { text: "base case" },
            mainTopicId: seeded.topicIds[0],
            instructionsMd: "Answer in a few words.",
            enableGuideMode: true,
          },
        },
      );
      expect(res.status()).toBe(201);

      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      // Walk to the short-text activity (question 2 of 2).
      await page.getByRole("button", { name: /^next$/i }).click();
      await expect(page.getByText("Name the case that stops a recursion.")).toBeVisible({
        timeout: 20_000,
      });
      const input = page.getByPlaceholder(/type your answer/i);
      await expect(page.getByRole("button", { name: /submit answer/i })).toBeDisabled();
      // Case/whitespace-insensitive match against the seeded answer "base case"
      // (`activityEvaluation.js` trims + lowercases), so the exact-typed answer
      // MUST grade correct — asserting the specific "Correct!" proves the
      // short-text grading ran, not merely that some result card rendered.
      await input.fill("  Base Case  ");
      await page.getByRole("button", { name: /submit answer/i }).click();
      await expect(page.getByText("Correct!")).toBeVisible({ timeout: 20_000 });
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor STUDENT — activity navigation", () => {
  test("Previous/Next walk the activities and update 'Question N of M'", async ({
    page,
    playwright,
  }) => {
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Nav Walk Course",
      codePrefix: "NWC",
      question: "First question?",
    });
    try {
      await seedMcqActivity(seeded.admin, seeded.lessonId, seeded.topicIds[0], {
        question: "Second question?",
      });

      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      await expect(page.getByText("First question?")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/Question 1 of 2/i).first()).toBeVisible();
      // Previous is disabled on the first activity.
      await expect(page.getByRole("button", { name: /^previous$/i })).toBeDisabled();

      await page.getByRole("button", { name: /^next$/i }).click();
      await expect(page.getByText("Second question?")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/Question 2 of 2/i).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /^next$/i })).toBeDisabled();

      await page.getByRole("button", { name: /^previous$/i }).click();
      await expect(page.getByText("First question?")).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });
});
