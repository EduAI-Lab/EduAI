/**
 * Penny help assistant E2E (#1816, #1822).
 *
 * Browser test: an admin turns the assistant on, then an instructor opens the
 * floating bubble, asks a question, and sees the answer with its guide citation.
 * The thread survives a reload, and on a chat screen the bubble is replaced by a
 * header button so it never covers the page's own composer.
 *
 * `/api/assistant/ask` is mocked: the grounded pipeline needs a live model key,
 * and its contract is covered by assistant-ask.pipeline/route unit tests.
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { CORE_URL } from "../../playwright.config";
import { createAdmin, createInstructor } from "../helpers/auth";

const BUBBLE_NAME = "Ask Penny, the help assistant";
const QUESTION = "How do I upload a course material?";
const ANSWER = "Open your course, choose Materials, then upload the file.";
const SOURCE = {
  id: "user-guide-materials",
  title: "Work with course materials",
  url: "/help/guide/user-guide-materials",
};

async function injectSession(page: Page, requestCtx: APIRequestContext): Promise<void> {
  const { cookies } = await requestCtx.storageState();
  await page.context().addCookies(cookies);
}

async function setHelpAssistant(adminCtx: APIRequestContext, enabled: boolean): Promise<void> {
  const res = await adminCtx.patch(`${CORE_URL}/api/admin/assistant-settings`, {
    data: { enableHelpAssistant: enabled },
  });
  expect(res.status()).toBe(200);
}

test.describe("Penny help assistant (#1816)", () => {
  test("instructor asks Penny from the bubble, and chat screens use the header button", async ({
    page,
    playwright,
  }) => {
    const adminCtx = await playwright.request.newContext();
    const instrCtx = await playwright.request.newContext();
    let previouslyEnabled: boolean | null = null;

    try {
      await createAdmin(adminCtx, { prefix: "penny-admin" });
      const current = await adminCtx.get(`${CORE_URL}/api/admin/assistant-settings`);
      expect(current.status()).toBe(200);
      previouslyEnabled = (await current.json()).settings.enableHelpAssistant === true;
      await setHelpAssistant(adminCtx, true);

      await createInstructor(instrCtx, { prefix: "penny-instr" });
      await injectSession(page, instrCtx);

      const askBodies: Array<{ question: string }> = [];
      await page.route("**/api/assistant/ask", async (route) => {
        askBodies.push(route.request().postDataJSON());
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            answer: ANSWER,
            sources: [SOURCE],
            scope: { docs: true, material: null },
          }),
        });
      });

      await page.goto(`${CORE_URL}/dashboard`);
      const bubble = page.getByRole("button", { name: BUBBLE_NAME });
      await expect(bubble).toBeVisible({ timeout: 15_000 });
      // The floating bubble is icon-only; the labelled variant belongs to chat screens.
      await expect(bubble).not.toContainText("Ask Penny");

      await bubble.click();
      const panel = page.getByRole("dialog", { name: "Penny" });
      await expect(panel).toBeVisible();

      const input = panel.getByRole("textbox", { name: "Ask Penny a question" });
      await input.fill(QUESTION);
      await input.press("Enter");

      await expect(panel.getByText(ANSWER)).toBeVisible();
      await expect(panel.getByRole("link", { name: SOURCE.title })).toHaveAttribute(
        "href",
        SOURCE.url,
      );
      expect(askBodies).toHaveLength(1);
      expect(askBodies[0].question).toBe(QUESTION);

      // The thread lives in this tab's storage, so a reload keeps it.
      await page.reload();
      await page.getByRole("button", { name: BUBBLE_NAME }).click();
      await expect(page.getByRole("dialog", { name: "Penny" }).getByText(ANSWER)).toBeVisible();

      // On a chat screen the only trigger is the labelled header button.
      await page.goto(`${CORE_URL}/instructor/chat`);
      const triggers = page.getByRole("button", { name: BUBBLE_NAME });
      await expect(triggers).toHaveCount(1, { timeout: 15_000 });
      await expect(triggers).toContainText("Ask Penny");
    } finally {
      if (previouslyEnabled !== null) await setHelpAssistant(adminCtx, previouslyEnabled);
      await adminCtx.dispose();
      await instrCtx.dispose();
    }
  });
});
