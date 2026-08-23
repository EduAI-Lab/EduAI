/**
 * AI Tutor — a TA also holds the STUDENT learner surface, through the browser.
 *
 * A TA is enrolment-mirrored (`enrollmentSync.js` `MIRRORED_ROLES` includes TA),
 * so besides the staff oversight shell they keep the full `/student/*` learner
 * experience: the enrolled-course list (reached by direct URL — a TA's sidebar
 * "Courses" points at `/instructor`), the lesson player, MCQ answering, and the
 * AI study buddy in its connect state. `student-ta-access.spec.ts` covers the
 * bare "a TA can open the lesson player" case; this spec walks the learner
 * surface the way a student uses it.
 *
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md` (TA).
 */
import { test, expect, type Page } from "@playwright/test";
import { gotoAiTutor } from "../helpers/at-ui";
import {
  registerStudent,
  seedPublishedCourseAndEnroll,
  seedByokKey,
} from "../helpers/at-student-fixtures";

type Pw = { request: { newContext: () => Promise<import("@playwright/test").APIRequestContext> } };

async function seedTaLearner(page: Page, playwright: Pw, codePrefix = "TLR") {
  const { studentId } = await registerStudent(page);
  const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
    name: "TA Learner Course",
    codePrefix,
    role: "TA",
  });
  return { studentId, seeded };
}

test.describe("AI Tutor TA — learner surface", () => {
  test("the /student enrolled-course list shows the TA's course by direct URL", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTaLearner(page, playwright, "TL1");
    try {
      // A TA has no sidebar entry for `/student`, but the learner list still
      // renders their enrolments when reached directly.
      await gotoAiTutor(page, "/student");
      await expect(page.getByRole("link", { name: new RegExp(seeded.name) }).first()).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await seeded.dispose();
    }
  });

  test("the lesson player renders the question, answer card, and study buddy", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTaLearner(page, playwright, "TL2");
    try {
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      await expect(page.getByText(seeded.question)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("Your answer")).toBeVisible();
      await expect(page.getByText("AI study buddy")).toBeVisible();
      await expect(page.getByRole("button", { name: /submit answer/i })).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });

  test("the player is read-only for a TA — options select but submitting is not their path", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTaLearner(page, playwright, "TL3");
    try {
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      // A TA can walk the player and pick an option (Submit gates on a
      // selection, so this proves the choice registered client-side) ...
      await expect(page.getByRole("button", { name: /submit answer/i })).toBeDisabled();
      await page.getByRole("radio", { name: "Option A" }).click();
      await expect(page.getByRole("button", { name: /submit answer/i })).toBeEnabled();

      // ... but recording an attempt is a STUDENT-enrolment path only
      // (`POST /questions/:id/answer` — "only enrolled STUDENTs may submit"), so
      // no graded result appears for a TA. See the API boundary in
      // `ta-security.spec.ts` and UI/UX note U-TA-1 (the submit silently no-ops).
      await page.getByRole("button", { name: /submit answer/i }).click();
      await expect(page.getByText("Correct!")).toHaveCount(0);
      await expect(page.getByText("Not quite. Keep going!")).toHaveCount(0);
    } finally {
      await seeded.dispose();
    }
  });

  test("the study buddy shows the connect-a-provider state with no BYOK key", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTaLearner(page, playwright, "TL4");
    try {
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      const chat = page.locator('[data-tour="student-ai-chat"]');
      await expect(chat.getByText("AI study buddy")).toBeVisible({ timeout: 20_000 });
      await expect(
        chat.getByRole("heading", { name: /Connect an AI provider to start/i }),
      ).toBeVisible();
      await expect(chat.getByRole("button", { name: /Add API key/i })).toBeVisible();
      await expect(chat.getByPlaceholder(/Connect a provider to start chatting/i)).toBeDisabled();
    } finally {
      await seeded.dispose();
    }
  });

  test("with a browser-local BYOK key the composer surface unlocks for the TA", async ({
    page,
    playwright,
  }) => {
    const { studentId, seeded } = await seedTaLearner(page, playwright, "TL5");
    try {
      await seedByokKey(page, studentId);
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      const chat = page.locator('[data-tour="student-ai-chat"]');
      await expect(chat.getByText("AI study buddy")).toBeVisible({ timeout: 20_000 });
      // The seeded key flips `hasApiKey`, so the connect state is gone and the
      // author-enabled modes (Teach me / Guide me) are offered.
      await expect(chat.getByText(/Connect an AI provider to start/i)).toHaveCount(0);
    } finally {
      await seeded.dispose();
    }
  });
});
