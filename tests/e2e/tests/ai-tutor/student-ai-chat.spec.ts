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
});
