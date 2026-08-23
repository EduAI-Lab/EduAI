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

  test("a TA drills course → module → lesson on the learner surface", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTaLearner(page, playwright, "TL1b");
    try {
      // The learner course/module pages admit a TA (their loaders allow TA and
      // the enrolment mirror lets them read published content), so the same
      // drill-down a student walks works for a TA.
      await gotoAiTutor(page, `/student/courses/${seeded.atCourseId}`);
      await expect(page.getByRole("heading", { name: seeded.name })).toBeVisible({
        timeout: 20_000,
      });

      await page.getByText("Spine module").first().click();
      await expect(page).toHaveURL(new RegExp(`/student/module/${seeded.moduleId}$`), {
        timeout: 20_000,
      });
      await expect(page.getByText("Spine lesson").first()).toBeVisible();

      await page.getByText("Spine lesson").first().click();
      await expect(page.getByText(seeded.question)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("Your answer")).toBeVisible();
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
      // Submit is NOT offered to a TA — recording an attempt is a STUDENT path
      // (U-TA-1 fix); the card explains why instead of showing a dead button.
      await expect(page.getByRole("button", { name: /submit answer/i })).toHaveCount(0);
      await expect(page.getByRole("note")).toContainText(/don.t submit answers/i);
    } finally {
      await seeded.dispose();
    }
  });

  test("the player withholds Submit for a TA and explains why (U-TA-1 fixed)", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTaLearner(page, playwright, "TL3");
    try {
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      await expect(page.getByText(seeded.question)).toBeVisible({ timeout: 20_000 });

      // Recording an attempt is a STUDENT-enrolment path (`POST
      // /questions/:id/answer` is 403 for a TA — see `ta-security.spec.ts`). The
      // player now withholds Submit and the answer inputs entirely, with a short
      // note, rather than a dead button that silently no-ops (U-TA-1).
      await expect(page.getByRole("button", { name: /submit answer/i })).toHaveCount(0);
      await expect(page.getByRole("note")).toContainText(/don.t submit answers/i);
      // The MCQ options are disabled — a TA cannot even stage an attempt.
      await expect(page.getByRole("radio", { name: "Option A" })).toBeDisabled();
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
