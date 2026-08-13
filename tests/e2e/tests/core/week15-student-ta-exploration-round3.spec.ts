/**
 * Week 15 (#1459) round 3 — Core "AI chatbot" granular sub-behaviors.
 *
 * Round 1 and round 2 treated "course chat" as one broad workflow ("does a
 * message send and a reply render"). Per PR #1466 review, that's too coarse
 * — this file breaks the chatbot down into its individually-testable pieces:
 * the model selector, ADHD Assist / Focus mode, the stop button, the system
 * prompt dialog, and — the highest-value addition — what the UI actually
 * does (or doesn't do) when /api/chat fails with a specific, known error
 * shape, replacing round 1/2's "waited 15s against an unreachable model and
 * saw nothing" with a controlled, reproducible probe per failure mode.
 *
 * The real LLM backend stays unreachable in this dev environment and no
 * provider has a real API key configured, so every test here mocks
 * /api/chat at the network boundary — same technique as the existing
 * chat-code-block.spec.ts and round 2's mocked course-chat tests. Findings
 * go in docs/end-to-end-user-workflows/eduai-core-workflows.md, not here.
 */
import { test, expect, type APIRequestContext, type Page, type Route } from '@playwright/test';
import { CORE_URL } from '../../playwright.config';

const PASSWORD = 'EduAI2026!';

const USERS = {
  student1: 'student1@eduai.local', // Alex Patel
};

const COURSES = {
  cosc101Code: 'COSC 101',
};

async function apiSignIn(ctx: APIRequestContext, email: string): Promise<void> {
  const res = await ctx.post(`${CORE_URL}/api/auth/sign-in/email`, {
    data: { email, password: PASSWORD },
  });
  expect(res.ok(), `sign-in failed for ${email}: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function injectSession(page: Page, requestCtx: APIRequestContext): Promise<void> {
  const { cookies } = await requestCtx.storageState();
  await page.context().addCookies(cookies);
}

async function newAuthedContext(playwright: any, email: string) {
  const ctx = await playwright.request.newContext();
  await apiSignIn(ctx, email);
  return ctx;
}

function buildMockStreamBody(text: string): string {
  return `0:${JSON.stringify(text)}\nd:${JSON.stringify({ finishReason: 'stop' })}\n`;
}

async function dismissChatPrivacyNoticeIfPresent(page: Page): Promise<void> {
  const understand = page.getByRole('button', { name: 'I understand' });
  await understand.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  if (await understand.count()) {
    await understand.click();
    await understand.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
  }
}

async function openCourseChat(page: Page): Promise<void> {
  await page.goto(`${CORE_URL}/chat?courseCode=${encodeURIComponent(COURSES.cosc101Code)}`);
  await dismissChatPrivacyNoticeIfPresent(page);
  const input = page.locator('#chat-message-input');
  await expect(input).toBeEnabled({ timeout: 15_000 });
}

test.beforeAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  try {
    const secret = process.env.E2E_SEED_SECRET ?? 'e2e-seed-secret';
    const res = await ctx.post(`${CORE_URL}/api/e2e/seed`, { data: { secret } });
    expect(res.ok(), `demo-data seed failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  } finally {
    await ctx.dispose();
  }
});

// ===========================================================================
// Model selector
// ===========================================================================

test.describe('Chat composer — model selector', () => {
  test('switching away from the default changes the model field sent to /api/chat', async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.student1);
    try {
      const capturedModels: (string | undefined)[] = [];
      await page.route('**/api/chat', async (route: Route) => {
        if (route.request().method() !== 'POST') {
          await route.continue();
          return;
        }
        capturedModels.push(route.request().postDataJSON()?.model);
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          body: buildMockStreamBody('ok'),
        });
      });

      await injectSession(page, ctx);
      await openCourseChat(page);

      const input = page.locator('#chat-message-input');
      await input.fill('First message on the default model.');
      await page.getByRole('button', { name: 'Send message' }).click();
      await expect
        .poll(() => capturedModels.length, { timeout: 15_000 })
        .toBeGreaterThanOrEqual(1);
      const defaultModel = capturedModels[0];

      // Switch models via the composer's model dropdown.
      const modelTrigger = page.locator('button').filter({ hasText: /Auto|Model/i }).first();
      await modelTrigger.click();
      const options = page.getByRole('menuitem');
      await expect(options.first()).toBeVisible({ timeout: 5_000 });
      const optionCount = await options.count();
      test.skip(optionCount < 2, 'Only one model available in this environment — nothing to switch to.');
      // Pick a non-default option (index 1, since index 0 is often the currently selected one).
      const targetOption = options.nth(1);
      const targetName = (await targetOption.textContent())?.trim();
      await targetOption.click();

      await input.fill('Second message on the newly selected model.');
      await page.getByRole('button', { name: 'Send message' }).click();
      await expect
        .poll(() => capturedModels.length, { timeout: 15_000 })
        .toBeGreaterThanOrEqual(2);
      const secondModel = capturedModels[1];

      expect(secondModel, 'model field should differ after switching away from the default').not.toBe(
        defaultModel,
      );

      test.info().annotations.push({
        type: 'finding',
        description: `Model selector correctly changes the request body: default="${defaultModel}", after switching to "${targetName}"="${secondModel}".`,
      });
    } finally {
      await ctx.dispose();
    }
  });
});

// ===========================================================================
// ADHD Assist — request field + /api/preferences persistence
// ===========================================================================

test.describe('Chat composer — ADHD Assist toggle', () => {
  test('toggling Assist sends adhdAssist in the request and persists via /api/preferences', async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.student1);
    try {
      // Known baseline before touching the toggle.
      await ctx.post(`${CORE_URL}/api/preferences`, { data: { assistDefault: false } });

      const capturedAdhdAssist: (boolean | undefined)[] = [];
      await page.route('**/api/chat', async (route: Route) => {
        if (route.request().method() !== 'POST') {
          await route.continue();
          return;
        }
        capturedAdhdAssist.push(route.request().postDataJSON()?.adhdAssist);
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          body: buildMockStreamBody('ok'),
        });
      });

      await injectSession(page, ctx);
      await openCourseChat(page);

      const assistToggle = page.getByRole('button', { name: 'Assistive mode' });
      await expect(assistToggle).toHaveAttribute('aria-pressed', 'false');
      await assistToggle.click();
      await expect(assistToggle).toHaveAttribute('aria-pressed', 'true');

      const input = page.locator('#chat-message-input');
      await input.fill('Message with Assist mode on.');
      await page.getByRole('button', { name: 'Send message' }).click();
      await expect.poll(() => capturedAdhdAssist.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
      expect(capturedAdhdAssist[0]).toBe(true);

      // The toggle is documented (chat-screen.tsx comment) to persist via
      // /api/preferences automatically, with no extra submit needed.
      await expect
        .poll(async () => {
          const res = await ctx.get(`${CORE_URL}/api/preferences`);
          return (await res.json()).assistDefault;
        }, { timeout: 10_000 })
        .toBe(true);
    } finally {
      // Reset so repeat runs and other specs sharing this account start clean.
      await ctx.post(`${CORE_URL}/api/preferences`, { data: { assistDefault: false } }).catch(() => {});
      await ctx.dispose();
    }
  });
});

// ===========================================================================
// Focus mode — confirmed UI-only, not sent to the server
// ===========================================================================

test.describe('Chat composer — Focus mode toggle', () => {
  test('Focus mode toggles its own UI state but is not part of the /api/chat request body', async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.student1);
    try {
      let capturedBody: any = null;
      await page.route('**/api/chat', async (route: Route) => {
        if (route.request().method() !== 'POST') {
          await route.continue();
          return;
        }
        capturedBody = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          body: buildMockStreamBody('ok'),
        });
      });

      await injectSession(page, ctx);
      await openCourseChat(page);

      const focusToggle = page.getByRole('button', { name: 'Focus mode' });
      await expect(focusToggle).toHaveAttribute('aria-pressed', 'false');
      await focusToggle.click();
      await expect(focusToggle).toHaveAttribute('aria-pressed', 'true');

      const input = page.locator('#chat-message-input');
      await input.fill('Message with Focus mode on.');
      await page.getByRole('button', { name: 'Send message' }).click();
      await expect.poll(() => capturedBody !== null, { timeout: 15_000 }).toBe(true);

      expect(
        Object.prototype.hasOwnProperty.call(capturedBody, 'focusMode'),
        'Focus mode is purely a client-side layout toggle (dims non-active content) — it should not appear in the request body at all',
      ).toBe(false);
    } finally {
      await ctx.dispose();
    }
  });
});

// ===========================================================================
// Stop button — abort mid-stream leaves no stray error state
// ===========================================================================

test.describe('Chat composer — stop button', () => {
  test('stopping a slow response clears the loading state without a false error', async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.student1);
    try {
      await page.route('**/api/chat', async (route: Route) => {
        if (route.request().method() !== 'POST') {
          await route.continue();
          return;
        }
        // fulfill() can't stream incrementally in Playwright's route mock, so
        // simulate "slow" by delaying the whole response instead — long enough
        // that Stop is clicked while isLoading is still true.
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          body: buildMockStreamBody('This is a slow reply.'),
        });
      });

      await injectSession(page, ctx);
      await openCourseChat(page);

      const input = page.locator('#chat-message-input');
      await input.fill('Send something slow.');
      await page.getByRole('button', { name: 'Send message' }).click();

      const stopButton = page.getByRole('button', { name: 'Stop generating' });
      await expect(stopButton).toBeVisible({ timeout: 5_000 });
      await stopButton.click();

      // Composer should return to its idle (Send visible, not disabled by
      // loading) state promptly, and no error text should appear anywhere.
      await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/error|failed|something went wrong/i)).toHaveCount(0);
    } finally {
      await ctx.dispose();
    }
  });
});

// ===========================================================================
// System prompt dialog
// ===========================================================================

test.describe('Chat composer — system prompt settings', () => {
  test('saving a custom system prompt includes it in the next /api/chat request', async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.student1);
    try {
      let capturedBody: any = null;
      await page.route('**/api/chat', async (route: Route) => {
        if (route.request().method() !== 'POST') {
          await route.continue();
          return;
        }
        capturedBody = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          body: buildMockStreamBody('ok'),
        });
      });

      await injectSession(page, ctx);
      await openCourseChat(page);

      await page.getByRole('button', { name: 'Chat settings' }).click();
      await expect(page.getByRole('heading', { name: 'Chat settings' })).toBeVisible();

      const promptText = `Round3 custom system prompt ${Date.now()}`;
      await page.locator('#system-prompt-edit').fill(promptText);
      await page.getByRole('button', { name: 'Save' }).click();

      // ApiKeySettings' handleSystemPromptSave never calls onOpenChange(false)
      // — the dialog stays open with no visible confirmation the save took
      // effect. Close it manually (Escape) to get back to the composer.
      test.info().annotations.push({
        type: 'finding',
        description:
          'apps/core/app/components/chat/api-key-settings.tsx handleSystemPromptSave/' +
          'handleSystemPromptClear never close the dialog or show any confirmation — ' +
          'the user clicks Save and nothing visibly happens, unlike the standalone (and ' +
          'apparently unused) system-prompt-settings.tsx which does close on save. Minor ' +
          'UX gap, not filed as a bug.',
      });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('heading', { name: 'Chat settings' })).not.toBeVisible({
        timeout: 5_000,
      });

      const input = page.locator('#chat-message-input');
      await input.fill('Message after saving a custom system prompt.');
      await page.getByRole('button', { name: 'Send message' }).click();
      await expect.poll(() => capturedBody !== null, { timeout: 15_000 }).toBe(true);

      expect(capturedBody.systemPrompt).toBe(promptText);
    } finally {
      await ctx.dispose();
    }
  });

  test('Clear removes an existing system prompt', async ({ page, playwright }) => {
    const ctx = await newAuthedContext(playwright, USERS.student1);
    try {
      await page.route('**/api/chat', (route: Route) =>
        route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          body: buildMockStreamBody('ok'),
        }),
      );

      await injectSession(page, ctx);
      await openCourseChat(page);

      await page.getByRole('button', { name: 'Chat settings' }).click();
      const promptField = page.locator('#system-prompt-edit');
      await promptField.fill('A prompt to be cleared.');
      const clearButton = page.getByRole('button', { name: 'Clear' });
      await expect(clearButton).toBeEnabled();
      await clearButton.click();

      // Same as Save — handleSystemPromptClear doesn't close the dialog either,
      // so verify the field itself emptied out instead of dialog visibility.
      await expect(promptField).toHaveValue('');
      await expect(clearButton).toBeDisabled();
    } finally {
      await ctx.dispose();
    }
  });
});

// ===========================================================================
// /api/chat failure modes — what the UI actually shows (or doesn't)
// ===========================================================================

test.describe('Chat composer — error handling per failure mode', () => {
  const cases: Array<{
    name: string;
    mock: (route: Route) => Promise<void>;
  }> = [
    {
      name: '502 LLM_STREAM_FAILED (model errored mid-stream)',
      mock: (route) =>
        route.fulfill({
          status: 502,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'LLM stream failed: fetch failed.', code: 'LLM_STREAM_FAILED' }),
        }),
    },
    {
      name: '400 provider not available (matches an unconfigured/unreachable model)',
      mock: (route) =>
        route.fulfill({
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: 'Provider "vllm" is not available on this server. Set VLLM_BASE_URL in apps/core/.env and restart the dev process.',
          }),
        }),
    },
    {
      name: 'connection refused (route.abort — closest match to a totally unreachable backend)',
      mock: (route) => route.abort('connectionrefused'),
    },
  ];

  for (const { name, mock } of cases) {
    test(`${name}: does the UI show anything to the user?`, async ({ page, playwright }) => {
      const ctx = await newAuthedContext(playwright, USERS.student1);
      try {
        await page.route('**/api/chat', async (route: Route) => {
          if (route.request().method() !== 'POST') {
            await route.continue();
            return;
          }
          await mock(route);
        });

        await injectSession(page, ctx);
        await openCourseChat(page);

        const input = page.locator('#chat-message-input');
        await input.fill('This request will fail.');
        await page.getByRole('button', { name: 'Send message' }).click();

        // Give the failure time to propagate through useChat's onError.
        await page.waitForTimeout(3_000);

        const sendVisible = await page.getByRole('button', { name: 'Send message' }).isVisible();
        const stopVisible = await page.getByRole('button', { name: 'Stop generating' }).isVisible();
        const errorTextCount = await page
          .getByText(/error|failed|try again|something went wrong/i)
          .count();

        test.info().annotations.push({
          type: 'finding',
          description:
            `[${name}] After the failure: composer shows Send button=${sendVisible}, ` +
            `stuck on Stop button=${stopVisible}, error-like text visible=${errorTextCount > 0} ` +
            `(useChat's \`error\` state is never destructured/rendered anywhere in the chat view ` +
            `components — apps/core/app/components/chat/chat-conversation-layout.tsx, ` +
            `chat-course-scoped-view.tsx, chat-input.tsx — so this is expected to be silent).`,
        });

        // Documenting the actual behavior rather than asserting a specific
        // outcome here — round 1/2 could only observe "no reply within 15s
        // against a genuinely unreachable model" (environment-confounded).
        // This is the controlled version: whatever happens is deterministic
        // and reproducible, and gets written up precisely in the workflows
        // doc rather than hedged as inconclusive.
      } finally {
        await ctx.dispose();
      }
    });
  }
});
