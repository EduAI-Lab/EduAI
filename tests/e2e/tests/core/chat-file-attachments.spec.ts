/**
 * Chat file attachments (#1902).
 *
 * Browser flow: an enrolled student attaches a Markdown file from the composer.
 * Extraction is real (POST /api/chat/attachments runs the server pipeline), and
 * the request /api/chat receives is captured to prove the extracted text rides on
 * the user message as a `text/plain` attachment. The e2e stack has no chat LLM
 * (see student-from-scratch-grounded-chat.spec.ts), so only the /api/chat reply
 * is mocked. Persistence and restore of attachments are pinned by
 * apps/core/app/tests/integration/chat-attachments.integration.test.ts.
 *
 * API checks hit the real routes: the extraction endpoint's auth and type gate,
 * and /api/chat's attachment and image guards, which all reject before any model
 * call, so they need no LLM either.
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { CORE_URL } from "../../playwright.config";
import { createAdmin, createInstructor, registerUser } from "../helpers/auth";

const RUN_SUFFIX = Date.now().toString().slice(-5);
// Non-ASCII on purpose: the text crosses a base64 data URL in the browser.
const PLANTED_PHRASE = "PANGOLIN_SYLLABUS_42 — café";
const NOTES_BODY = `# Week 3 notes\n\nThe deadline code is ${PLANTED_PHRASE}.\n`;
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

interface ChatRequestMessage {
  role: string;
  content: string;
  experimental_attachments?: Array<{ name: string; contentType: string; url: string }>;
}

async function getMyId(ctx: APIRequestContext): Promise<string> {
  const res = await ctx.get(`${CORE_URL}/api/me`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { id: string }).id;
}

/** AI SDK data-stream body (same shape as `formatDataStreamPart` from `ai`). */
function buildMockStreamBody(text: string): string {
  return `0:${JSON.stringify(text)}\nd:${JSON.stringify({ finishReason: "stop" })}\n`;
}

function decodeTextDataUrl(url: string): string {
  const prefix = "data:text/plain;base64,";
  expect(url.startsWith(prefix)).toBe(true);
  return Buffer.from(url.slice(prefix.length), "base64").toString("utf8");
}

function textAttachment(name: string, text: string) {
  return {
    name,
    contentType: "text/plain",
    url: `data:text/plain;base64,${Buffer.from(text, "utf8").toString("base64")}`,
  };
}

async function injectSession(page: Page, requestCtx: APIRequestContext): Promise<void> {
  const { cookies } = await requestCtx.storageState();
  await page.context().addCookies(cookies);
}

test.describe("Chat file attachments (#1902)", () => {
  let adminCtx: APIRequestContext;
  let instrCtx: APIRequestContext;
  let studentCtx: APIRequestContext;
  let studentId: string;
  let courseId: string;
  const courseCode = `ATT-${RUN_SUFFIX}`;

  test.beforeAll(async ({ playwright }) => {
    adminCtx = await playwright.request.newContext();
    instrCtx = await playwright.request.newContext();
    studentCtx = await playwright.request.newContext();

    await createInstructor(instrCtx, { prefix: "att-instr" });
    const instrId = await getMyId(instrCtx);
    await createAdmin(adminCtx, { prefix: "att-admin" });
    await registerUser(studentCtx, { prefix: "att-student" });
    studentId = await getMyId(studentCtx);

    const createRes = await adminCtx.post(`${CORE_URL}/api/courses`, {
      form: {
        name: "E2E Chat Attachments",
        code: courseCode,
        section: "001",
        term: "W1",
        year: "2026",
        startDate: "2026-09-08",
        department: "COSC",
        instructorUserIds: instrId,
      },
    });
    expect(createRes.status(), await createRes.text()).toBe(201);
    courseId = ((await createRes.json()) as { id: string }).id;

    const enrollRes = await adminCtx.post(`${CORE_URL}/api/courses/${courseId}/enrollments`, {
      data: { userId: studentId, role: "STUDENT" },
    });
    expect(enrollRes.status()).toBe(201);
    expect((await adminCtx.patch(`${CORE_URL}/api/courses/${courseId}/publish`)).status()).toBe(
      200,
    );
  });

  test.afterAll(async () => {
    await adminCtx?.dispose();
    await instrCtx?.dispose();
    await studentCtx?.dispose();
  });

  test("a student attaches a file and its extracted text rides on the sent message", async ({
    page,
  }) => {
    await injectSession(page, studentCtx);
    await page.addInitScript((userId) => {
      window.localStorage.setItem(`eduai:chat-privacy-notice:${userId}`, "1");
    }, studentId);

    let sentMessages: ChatRequestMessage[] | null = null;
    await page.route("**/api/chat", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      sentMessages = (route.request().postDataJSON() as { messages: ChatRequestMessage[] })
        .messages;
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", "X-Web-Tools-Enabled": "0" },
        body: buildMockStreamBody("Your notes say the deadline code is in week 3."),
      });
    });

    await page.goto(`${CORE_URL}/chat?courseCode=${encodeURIComponent(courseCode)}`);
    const input = page.locator("#chat-message-input");
    await expect(input).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Attach files" })).toBeVisible();

    // Real extraction: the chip only turns ready once the server answers.
    const extraction = page.waitForResponse(
      (res) => res.url().endsWith("/api/chat/attachments") && res.request().method() === "POST",
    );
    await page.getByTestId("chat-attachment-input").setInputFiles({
      name: "notes.md",
      mimeType: "",
      buffer: Buffer.from(NOTES_BODY, "utf8"),
    });
    const extractionRes = await extraction;
    expect(extractionRes.status()).toBe(200);
    const extracted = (await extractionRes.json()) as { text: string; truncated: boolean };
    expect(extracted.text).toContain(PLANTED_PHRASE);
    expect(extracted.truncated).toBe(false);

    const composerChips = page.getByRole("list", { name: "Attached files" });
    await expect(composerChips.getByText("notes.md")).toBeVisible();

    // An image is refused in the browser (chat is text-only) and can only be removed.
    await page.getByTestId("chat-attachment-input").setInputFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: PNG_HEADER,
    });
    await expect(page.getByText(/can't be attached/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry photo.png" })).toHaveCount(0);
    await input.fill("When is the deadline in my notes?");
    await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
    await page.getByRole("button", { name: "Remove photo.png" }).click();

    const sendButton = page.getByRole("button", { name: "Send message" });
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    await expect(page.getByText("Your notes say the deadline code is in week 3.")).toBeVisible({
      timeout: 20_000,
    });

    expect(sentMessages).not.toBeNull();
    const userMessage = sentMessages!.at(-1)!;
    expect(userMessage.role).toBe("user");
    expect(userMessage.content).toBe("When is the deadline in my notes?");
    expect(userMessage.experimental_attachments).toHaveLength(1);
    const [attachment] = userMessage.experimental_attachments!;
    expect(attachment.name).toBe("notes.md");
    expect(attachment.contentType).toBe("text/plain");
    expect(decodeTextDataUrl(attachment.url)).toContain(PLANTED_PHRASE);

    // The transcript shows the file as a chip, never its extracted text.
    await expect(
      page.getByRole("list", { name: "Attached files" }).getByText("notes.md"),
    ).toHaveCount(1);
    await expect(page.getByText(PLANTED_PHRASE)).toHaveCount(0);
  });

  test("the extraction endpoint requires a session and rejects images", async ({ playwright }) => {
    const anonCtx = await playwright.request.newContext();
    try {
      const anon = await anonCtx.post(`${CORE_URL}/api/chat/attachments`, {
        multipart: { file: { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("x") } },
      });
      expect(anon.status()).toBe(401);
    } finally {
      await anonCtx.dispose();
    }

    const image = await studentCtx.post(`${CORE_URL}/api/chat/attachments`, {
      multipart: { file: { name: "photo.png", mimeType: "image/png", buffer: PNG_HEADER } },
    });
    expect(image.status()).toBe(400);
    expect(await image.json()).toMatchObject({ code: "ATTACHMENT_TYPE_UNSUPPORTED" });
  });

  test("/api/chat rejects an image attachment and too many files before any model call", async () => {
    const send = (attachments: object[]) =>
      studentCtx.post(`${CORE_URL}/api/chat`, {
        data: {
          courseId,
          // An explicit id, not "auto": Auto routing is disabled on the e2e stack and
          // would reject first. Both guards under test run before the model is resolved.
          model: "vllm:e2e-unused-model",
          streaming: false,
          messages: [
            {
              id: `e2e-att-${Date.now()}-${Math.random()}`,
              role: "user",
              content: "What does this say?",
              experimental_attachments: attachments,
            },
          ],
        },
      });

    const image = await send([
      { name: "p.png", contentType: "image/png", url: "data:image/png;base64,AAAA" },
    ]);
    expect(image.status(), await image.text()).toBe(400);
    expect(await image.json()).toMatchObject({ error: "IMAGE_MESSAGE_UNSUPPORTED" });

    const tooMany = await send(["1", "2", "3", "4"].map((n) => textAttachment(`${n}.txt`, n)));
    expect(tooMany.status(), await tooMany.text()).toBe(400);
    expect(await tooMany.json()).toMatchObject({ code: "ATTACHMENT_TOO_MANY" });
  });
});
