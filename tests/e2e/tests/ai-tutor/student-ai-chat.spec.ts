/**
 * AI Tutor — STUDENT "AI study buddy" chat (`StudentAiChat`), driven through
 * the browser on the lesson player.
 *
 * The e2e stack ships no model-provider key and an empty model catalogue, so a
 * real tutoring answer cannot be produced here — that path is human-pass-only
 * (it needs a live provider). What IS walkable, and covered here:
 *   - the default "Connect an AI provider" state and its Add-API-key dialog;
 *   - the empty model catalogue notice;
 *   - the connected surface once a browser-local BYOK key exists: the mode
 *     switch, the knowledge-level chips, the focus-topic select, and the
 *     composer's send-gating.
 *
 * `seedByokKey` writes the same `ai-provider-keys:v2:<userId>` localStorage
 * entry the Settings → Providers tab and the in-chat dialog write, so
 * `hasApiKey` flips true exactly as it would for a real student who saved a key.
 *
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md`.
 */
import { test, expect } from "@playwright/test";
import { gotoAiTutor } from "../helpers/at-ui";
import {
  registerStudent,
  seedByokKey,
  seedPublishedCourseAndEnroll,
} from "../helpers/at-student-fixtures";

test.describe("AI Tutor STUDENT — chat with no provider key connected", () => {
  test("shows the 'Connect an AI provider' state with an Add-key CTA and Settings link", async ({
    page,
    playwright,
  }) => {
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Chat No Key Course",
      codePrefix: "CNK",
    });
    try {
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      const chat = page.locator('[data-tour="student-ai-chat"]');
      await expect(chat.getByText("AI study buddy")).toBeVisible({ timeout: 20_000 });
      await expect(
        chat.getByRole("heading", { name: /Connect an AI provider to start/i }),
      ).toBeVisible();
      await expect(chat.getByRole("button", { name: /Add API key/i })).toBeVisible();
      await expect(chat.getByRole("link", { name: /Manage in Settings/i })).toBeVisible();
      // Composer is disabled and says so; the catalogue is empty.
      await expect(chat.getByPlaceholder(/Connect a provider to start chatting/i)).toBeDisabled();
      await expect(chat.getByText(/No AI models configured/i)).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });

  test("the Add-API-key dialog opens with a masked key field", async ({ page, playwright }) => {
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Chat Key Dialog Course",
      codePrefix: "CKD",
    });
    try {
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      const chat = page.locator('[data-tour="student-ai-chat"]');
      await chat.getByRole("button", { name: /Add API key/i }).click();

      const dialog = page.locator('[role="dialog"]');
      await expect(dialog.getByText(/API key$/i).first()).toBeVisible();
      const field = dialog.getByPlaceholder(/Enter your .* API key/i);
      await expect(field).toBeVisible();
      await expect(field).toHaveAttribute("type", "password");
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor STUDENT — chat with a BYOK key connected", () => {
  test("the composer, mode switch, and knowledge-level chips become available", async ({
    page,
    playwright,
  }) => {
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Chat Connected Course",
      codePrefix: "CCC",
    });
    try {
      await seedByokKey(page, studentId);
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      const chat = page.locator('[data-tour="student-ai-chat"]');
      await expect(chat.getByText("AI study buddy")).toBeVisible({ timeout: 20_000 });

      // The connect-a-provider empty state is gone.
      await expect(chat.getByText(/Connect an AI provider to start/i)).toHaveCount(0);
      // The seeded activity enables Teach me + Guide me, so the mode switch shows.
      await expect(chat.getByText("Teach me")).toBeVisible();
      await expect(chat.getByText("Guide me").first()).toBeVisible();
      // With no level chosen yet, the knowledge-level chips are the prompt.
      await expect(chat.getByText(/How much do you already know/i)).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });

  test("choosing a knowledge level unlocks the ask-anything prompt and level toggle", async ({
    page,
    playwright,
  }) => {
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Chat Level Course",
      codePrefix: "CLV",
    });
    try {
      await seedByokKey(page, studentId);
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      const chat = page.locator('[data-tour="student-ai-chat"]');
      await chat.getByRole("button", { name: "New to this" }).click();

      await expect(chat.getByText(/Ask your study buddy anything about this topic/i)).toBeVisible({
        timeout: 20_000,
      });
      // The chosen level is now a toggle in the control row.
      await expect(chat.getByRole("button", { name: /Change knowledge level/i })).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });

  test("Send stays disabled until the composer has text", async ({ page, playwright }) => {
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Chat Send Gate Course",
      codePrefix: "CSG",
    });
    try {
      await seedByokKey(page, studentId);
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      const chat = page.locator('[data-tour="student-ai-chat"]');
      // Pick a level so the composer is the focus.
      await chat.getByRole("button", { name: "New to this" }).click();

      const send = chat.getByRole("button", { name: "Send message" });
      await expect(send).toBeDisabled();
      const composer = chat.getByRole("textbox").last();
      await composer.fill("How do I start?");
      await expect(send).toBeEnabled();
    } finally {
      await seeded.dispose();
    }
  });

  test("New chat and Chat history controls appear once a provider is connected", async ({
    page,
    playwright,
  }) => {
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Chat Controls Course",
      codePrefix: "CTL",
    });
    try {
      await seedByokKey(page, studentId);
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      const chat = page.locator('[data-tour="student-ai-chat"]');
      await expect(chat.getByText("AI study buddy")).toBeVisible({ timeout: 20_000 });

      // Both header controls gate on `activity && hasApiKey` — present here.
      await expect(chat.getByRole("button", { name: "New chat" })).toBeVisible();
      await chat.getByRole("button", { name: "Chat history" }).click();
      // The history sheet opens; with no prior sessions it shows its empty state.
      const sheet = page.getByRole("dialog");
      await expect(sheet.getByText(/No conversations yet/i)).toBeVisible({ timeout: 20_000 });
    } finally {
      await seeded.dispose();
    }
  });

  test("the composer's Model select is present but disabled with an empty catalogue", async ({
    page,
    playwright,
  }) => {
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Chat Model Select Course",
      codePrefix: "CMS",
    });
    try {
      await seedByokKey(page, studentId);
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      const chat = page.locator('[data-tour="student-ai-chat"]');
      // Pick a level so the composer (which carries the Model select) renders.
      await chat.getByRole("button", { name: "New to this" }).click();

      const model = chat.getByRole("combobox", { name: "Model" });
      await expect(model).toBeVisible({ timeout: 20_000 });
      // The e2e Core catalogue is empty, so the select is disabled rather than
      // offering a model the tutor cannot actually reach.
      await expect(model).toBeDisabled();
    } finally {
      await seeded.dispose();
    }
  });

  test("per-mode suggested-prompt chips appear once a level is chosen, and a chip fills the composer without sending", async ({
    page,
    playwright,
  }) => {
    // The chips are driven by `GET /api/suggested-prompts`, which reads the
    // global `SuggestedPrompt` table. The e2e AI-Tutor server boots with
    // `prisma migrate deploy && node src/index.js` and never seeds that table
    // (only the `dev` script runs the seed), so the endpoint returns `[]` in
    // this stack and the chips can't render from real data. Stub the read to
    // exercise the client behaviour the row documents: chips render for the
    // active mode once a knowledge level is set, and clicking one *fills* the
    // composer (`handleSuggestedPromptClick` sets input only) rather than
    // sending — no live model is involved either way.
    const teachPrompt = "E2E: can you explain this in simpler terms?";
    await page.route("**/api/suggested-prompts", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: "e2e-teach-1", mode: "teach", text: teachPrompt },
          { id: "e2e-guide-1", mode: "guide", text: "E2E: give me a hint." },
        ]),
      }),
    );

    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Chat Suggested Prompts Course",
      codePrefix: "CSP",
    });
    try {
      await seedByokKey(page, studentId);
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      const chat = page.locator('[data-tour="student-ai-chat"]');
      // Pick a level so the chips can show against an empty thread. The seeded
      // activity enables Teach me + Guide me, and the chat opens on Guide me by
      // default (StudentAiChat seeds `activeTab` to "guide"), so switch to the
      // Teach me tab to exercise the teach-mode prompt below.
      await chat.getByRole("button", { name: "New to this" }).click();
      await chat.getByRole("radio", { name: "Teach me" }).click();

      await expect(chat.getByText("Try asking")).toBeVisible({ timeout: 20_000 });
      const chip = chat.getByRole("button", { name: teachPrompt });
      await expect(chip).toBeVisible();

      // Clicking a chip fills the composer, it does not send.
      await chip.click();
      const composer = chat.getByRole("textbox").last();
      await expect(composer).toHaveValue(teachPrompt);
      // No send happened: the empty-thread chips (which a send would dismiss)
      // are still on screen.
      await expect(chat.getByText("Try asking")).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });

  test("'Change knowledge level' opens the 'Before we start' modal", async ({
    page,
    playwright,
  }) => {
    // The pre-chat knowledge modal is reachable in this stack: a seeded BYOK key
    // connects the provider, choosing a level surfaces the "Change knowledge
    // level" affordance, and clicking it opens the modal — no live model needed.
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Chat Knowledge Modal Course",
      codePrefix: "CKM",
    });
    try {
      await seedByokKey(page, studentId);
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      const chat = page.locator('[data-tour="student-ai-chat"]');
      await chat.getByRole("button", { name: "New to this" }).click();
      await chat.getByRole("button", { name: /Change knowledge level/i }).click();

      const modal = page.getByRole("dialog");
      await expect(modal.getByText(/Before we start/i)).toBeVisible({ timeout: 20_000 });
      await expect(modal.getByText(/knowledge level on this topic/i)).toBeVisible();
      // "Start guidance" gates on a chosen level; a fresh open re-selects one.
      const start = modal.getByRole("button", { name: /Start guidance/i });
      await expect(start).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });
});
