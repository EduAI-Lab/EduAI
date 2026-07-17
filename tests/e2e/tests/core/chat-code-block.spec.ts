/**
 * Chat code-block toolbar E2E regression (#667).
 *
 * Browser test: enrolled student sends a message, a mocked /api/chat stream returns
 * a fenced code block, and Streamdown copy/download controls work after streaming
 * completes (buttons are disabled while isAnimating).
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CORE_URL } from '../../playwright.config';
import { createAdmin, createInstructor, registerUser } from '../helpers/auth';

const RUN_SUFFIX = Date.now().toString().slice(-5);
const CODE_SAMPLE = 'console.log("hello");';
const ASSISTANT_MARKDOWN = '```js\n' + CODE_SAMPLE + '\n```';

async function getMyId(ctx: APIRequestContext): Promise<string> {
  const res = await ctx.get(`${CORE_URL}/api/me`);
  return (await res.json()).id;
}

function coursePayload(instrId: string, overrides: Record<string, string> = {}) {
  const { code: codeBase, ...rest } = overrides;
  return {
    name: 'E2E Code Block Course',
    code: `${codeBase ?? 'CBK'}-${RUN_SUFFIX}`,
    section: '001',
    term: 'W1',
    year: '2026',
    startDate: '2026-08-15',
    department: 'COSC',
    instructorUserIds: instrId,
    ...rest,
  };
}

/** AI SDK data-stream body (same shape as `formatDataStreamPart` from `ai`). */
function buildMockStreamBody(text: string): string {
  return `0:${JSON.stringify(text)}\nd:${JSON.stringify({ finishReason: 'stop' })}\n`;
}

async function injectSession(page: Page, requestCtx: APIRequestContext): Promise<void> {
  const { cookies } = await requestCtx.storageState();
  await page.context().addCookies(cookies);
}

test.describe('Chat code-block toolbar (#667)', () => {
  test('copy and download work after a streamed fenced code block', async ({ page, playwright }) => {
    const adminCtx = await playwright.request.newContext();
    const instrCtx = await playwright.request.newContext();
    const studentCtx = await playwright.request.newContext();

    try {
      await createInstructor(instrCtx, { prefix: 'cb-instr' });
      const instrId = await getMyId(instrCtx);
      await createAdmin(adminCtx, { prefix: 'cb-admin' });
      await registerUser(studentCtx, { prefix: 'cb-student' });

      const { id: studentId } = await (await studentCtx.get(`${CORE_URL}/api/me`)).json();

      const courseCode = `CBK-${RUN_SUFFIX}`;
      const createRes = await adminCtx.post(`${CORE_URL}/api/courses`, {
        form: coursePayload(instrId, { code: courseCode }),
      });
      expect(createRes.status()).toBe(201);
      const { id: courseId } = await createRes.json();

      const enrollRes = await adminCtx.post(`${CORE_URL}/api/courses/${courseId}/enrollments`, {
        data: { userId: studentId, role: 'STUDENT' },
      });
      expect(enrollRes.status()).toBe(201);

      const pubRes = await adminCtx.patch(`${CORE_URL}/api/courses/${courseId}/publish`);
      expect(pubRes.status()).toBe(200);

      await injectSession(page, studentCtx);
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

      const streamBody = buildMockStreamBody(ASSISTANT_MARKDOWN);
      await page.route('**/api/chat', async (route) => {
        if (route.request().method() !== 'POST') {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Web-Tools-Enabled': '0',
          },
          body: streamBody,
        });
      });

      await page.goto(`${CORE_URL}/chat?courseCode=${encodeURIComponent(courseCode)}`);

      // #708 adds a "Your chat may be reviewed" privacy notice for course chats.
      // While open it renders the rest of the page aria-hidden, so the composer's
      // Send button is absent from the accessibility tree until it's dismissed.
      await page.getByRole('button', { name: 'I understand' }).click();

      const input = page.locator('#chat-message-input');
      await expect(input).toBeEnabled({ timeout: 15_000 });

      await input.fill('Show me hello world in JavaScript');
      await page.getByRole('button', { name: 'Send message' }).click();

      const copyBtn = page.getByTitle('Copy Code');
      // Code-block copy/download stay disabled while isAnimating. Do not assert on Send:
      // useChat clears the input after submit, so Send stays disabled even when idle.
      await expect(copyBtn).toBeEnabled({ timeout: 20_000 });

      await copyBtn.click();
      await expect
        .poll(async () => page.evaluate(() => navigator.clipboard.readText()))
        .toContain(CODE_SAMPLE);

      const downloadBtn = page.getByTitle('Download file');
      await expect(downloadBtn).toBeEnabled();

      const downloadPromise = page.waitForEvent('download');
      await downloadBtn.click();
      const download = await downloadPromise;

      const tmpPath = path.join(os.tmpdir(), `e2e-code-block-${Date.now()}.txt`);
      await download.saveAs(tmpPath);
      try {
        const fileContent = fs.readFileSync(tmpPath, 'utf-8');
        expect(fileContent).toContain(CODE_SAMPLE);
      } finally {
        fs.unlinkSync(tmpPath);
      }
    } finally {
      await adminCtx.dispose();
      await instrCtx.dispose();
      await studentCtx.dispose();
    }
  });
});
