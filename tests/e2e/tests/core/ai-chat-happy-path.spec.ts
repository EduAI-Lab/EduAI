/**
 * Core student AI-chat happy path for end-user testing (#1429, #1459).
 *
 * This deliberately drives the browser UI while mocking only the streamed AI
 * provider response, so the test remains deterministic and still exercises the
 * real course-scoped chat experience.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { CORE_URL } from '../../playwright.config';
import { createAdmin, createInstructor, registerUser } from '../helpers/auth';

const RUN_SUFFIX = Date.now().toString().slice(-5);

async function getMyId(ctx: APIRequestContext): Promise<string> {
  const res = await ctx.get(`${CORE_URL}/api/me`);
  return (await res.json()).id;
}

async function injectSession(page: Page, ctx: APIRequestContext): Promise<void> {
  const { cookies } = await ctx.storageState();
  await page.context().addCookies(cookies);
}

function buildMockStreamBody(text: string): string {
  return `0:${JSON.stringify(text)}\nd:${JSON.stringify({ finishReason: 'stop' })}\n`;
}

test.describe('Core student AI chat happy path (#1429, #1459)', () => {
  test('enrolled student can ask a course question and read the assistant answer', async ({ page, playwright }) => {
    const adminCtx = await playwright.request.newContext();
    const instructorCtx = await playwright.request.newContext();
    const studentCtx = await playwright.request.newContext();

    try {
      await createInstructor(instructorCtx, { prefix: 'chat-happy-instr' });
      await createAdmin(adminCtx, { prefix: 'chat-happy-admin' });
      await registerUser(studentCtx, { prefix: 'chat-happy-student' });

      const instructorId = await getMyId(instructorCtx);
      const studentId = await getMyId(studentCtx);
      const courseCode = `CHAT-${RUN_SUFFIX}`;
      const courseRes = await adminCtx.post(`${CORE_URL}/api/courses`, {
        form: {
          name: 'AI Chat Happy Path',
          code: courseCode,
          section: '001',
          term: 'W1',
          year: '2026',
          startDate: '2026-09-08',
          department: 'COSC',
          instructorUserIds: instructorId,
        },
      });
      expect(courseRes.status()).toBe(201);
      const { id: courseId } = await courseRes.json();

      expect((await adminCtx.post(`${CORE_URL}/api/courses/${courseId}/enrollments`, {
        data: { userId: studentId, role: 'STUDENT' },
      })).status()).toBe(201);
      expect((await adminCtx.patch(`${CORE_URL}/api/courses/${courseId}/publish`)).status()).toBe(200);

      await injectSession(page, studentCtx);
      await page.route('**/api/chat', async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Web-Tools-Enabled': '0' },
          body: buildMockStreamBody('The mitochondria is the powerhouse of the cell.'),
        });
      });

      await page.goto(`${CORE_URL}/chat?courseCode=${encodeURIComponent(courseCode)}`);
      await page.getByRole('button', { name: 'I understand' }).click();

      const input = page.locator('#chat-message-input');
      await expect(input).toBeEnabled({ timeout: 15_000 });
      await input.fill('What is the powerhouse of the cell?');
      await page.getByRole('button', { name: 'Send message' }).click();

      await expect(page.getByText('What is the powerhouse of the cell?', { exact: true })).toBeVisible();
      await expect(page.getByText('The mitochondria is the powerhouse of the cell.', { exact: true }))
        .toBeVisible({ timeout: 20_000 });
    } finally {
      await adminCtx.dispose();
      await instructorCtx.dispose();
      await studentCtx.dispose();
    }
  });
});
