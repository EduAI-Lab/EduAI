/**
 * Week 15 (#1459) round 2 — Core Student & TA end-to-end exploration.
 *
 * Follow-up pass per PR #1466 review (ariqmuldi): repeats Epic #1429's
 * find -> simulate -> review -> gap-sweep loop over the areas the round-1
 * pass (week15-student-ta-exploration.spec.ts) flagged as known gaps —
 * canManageTopics, chat delete/switch/rename, bug-report UI submission,
 * /help role filtering, /settings account actions, and course chat with a
 * deterministic (mocked) reply — plus a fresh enumeration on top. Findings
 * are written up in docs/end-to-end-user-workflows/eduai-core-workflows.md,
 * not here. Kept as a separate file from round 1 rather than growing that
 * file past ~500 lines.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { CORE_URL } from '../../playwright.config';
import { registerUser } from '../helpers/auth';

const PASSWORD = 'EduAI2026!';

const USERS = {
  student1: 'student1@eduai.local', // Alex Patel — cosc101, cosc121, math200, data310, phys121, engl110 (all published)
  taCS: 'ta.cs@eduai.local',        // Sam Carter — TA in cosc101, cosc121 only. Platform role = STUDENT.
  admin: 'admin@eduai.local',
};

const COURSES = {
  cosc101: 'seed_course_cosc101', // published, taCS is TA, student1 enrolled
};

// Seeded, owner-less (createdBy: null) topic — round 1's TA-create-question
// test also references this slug, so tests here restore its name afterward.
const SEEDED_TOPIC = {
  id: 'seed_topic_cosc101_computational_thinking',
  name: 'Computational Thinking',
};

const POLICY_KEY = 'tas.canManageTopics';

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

// A student's first visit to a course-scoped chat shows a one-time "Your chat
// may be reviewed" AlertDialog (localStorage-gated per user, so it fires on
// every fresh Playwright context). While open, Radix marks the rest of the
// page aria-hidden — dismiss it before touching anything else on the page,
// same as chat-code-block.spec.ts does for the mocked-reply flow.
async function dismissChatPrivacyNoticeIfPresent(page: Page): Promise<void> {
  const understand = page.getByRole('button', { name: 'I understand' });
  await understand.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  if (await understand.count()) {
    await understand.click();
    await understand.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
  }
}

// The dashboard's guided product tour auto-starts once per browser (plain
// localStorage flag, not scoped per-user — apps/core/app/components/tour/tour-steps.ts
// DASHBOARD_TOUR_STORAGE_KEY) and its full-screen overlay blocks/aria-hides
// the rest of the page. Pre-seed the "already seen" flag so it never opens.
async function skipDashboardTour(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('eduai:tour:dashboard:v1', '1');
  });
}

// TAs are STUDENT platform users (Enrollment.role carries TA status, not the
// platform role — apps/core/app/lib/canvas/onboarding.server.ts), so a TA
// without a linked Canvas student number gets redirected from /dashboard to
// /onboarding/student-id on first visit, same as a real student would. This
// is a deliberate, documented design choice (not a bug), with a 30-day skip
// cookie already built in — set it directly rather than clicking through.
async function skipStudentIdOnboarding(page: Page): Promise<void> {
  await page.context().addCookies([
    { name: 'eduai_student_id_onboarding_skipped', value: '1', url: CORE_URL },
  ]);
}

async function setPolicy(adminCtx: APIRequestContext, value: boolean): Promise<void> {
  const res = await adminCtx.patch(`${CORE_URL}/api/policies`, {
    data: { key: POLICY_KEY, value },
  });
  expect(res.status(), `PATCH /api/policies ${POLICY_KEY}=${value} -> ${res.status()}`).toBe(200);
}

// Creates a real, persisted Chat row without touching the (unreachable in
// this dev env) LLM backend: chat.ts creates the Chat as soon as a
// systemPrompt is present, then short-circuits with a fast 200 when
// mergedMessages is empty (messages: []) — no model call, no hang.
// #657 removed the course-less "general assistant" chat — every interactive
// chat is now course-scoped, so courseId is required here (not optional).
async function createFastChat(
  ctx: APIRequestContext,
  systemPrompt: string,
  courseId: string,
): Promise<string> {
  const res = await ctx.post(`${CORE_URL}/api/chat`, {
    data: { messages: [], systemPrompt, courseId },
  });
  expect(res.ok(), `createFastChat failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  expect(body.chatId, 'createFastChat: no chatId in response').toBeTruthy();
  return body.chatId as string;
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
// canManageTopics (policy-gated TA permission) — #1429 known gap
// ===========================================================================

test.describe('TA — canManageTopics policy edge cases', () => {
  test('policy OFF (default): TA cannot create a topic', async ({ playwright }) => {
    const adminCtx = await newAuthedContext(playwright, USERS.admin);
    const taCtx = await newAuthedContext(playwright, USERS.taCS);
    try {
      await setPolicy(adminCtx, false); // ensure known baseline
      const res = await taCtx.post(`${CORE_URL}/api/courses/${COURSES.cosc101}/topics`, {
        data: { name: 'Round2 Probe Topic (should not persist)' },
      });
      expect(res.status()).toBe(403);
    } finally {
      await adminCtx.dispose();
      await taCtx.dispose();
    }
  });

  test('policy OFF: TA cannot rename or delete an existing owner-less (seeded) topic', async ({
    playwright,
  }) => {
    const adminCtx = await newAuthedContext(playwright, USERS.admin);
    const taCtx = await newAuthedContext(playwright, USERS.taCS);
    try {
      await setPolicy(adminCtx, false);
      const renameRes = await taCtx.patch(
        `${CORE_URL}/api/courses/${COURSES.cosc101}/topics/${SEEDED_TOPIC.id}`,
        { data: { name: 'Hacked Topic Name' } },
      );
      expect(renameRes.status()).toBe(403);

      const deleteRes = await taCtx.delete(
        `${CORE_URL}/api/courses/${COURSES.cosc101}/topics/${SEEDED_TOPIC.id}`,
        { data: { topicId: SEEDED_TOPIC.id } },
      );
      expect(deleteRes.status()).toBe(403);
    } finally {
      await adminCtx.dispose();
      await taCtx.dispose();
    }
  });

  test('policy ON then OFF: own-only carve-out survives the toggle for a topic the TA created while it was ON', async ({
    playwright,
  }) => {
    const adminCtx = await newAuthedContext(playwright, USERS.admin);
    const taCtx = await newAuthedContext(playwright, USERS.taCS);
    let createdTopicId: string | undefined;
    try {
      // Unique per run — courseTopic has a (courseId, name) uniqueness
      // constraint, and a name reused across runs would 409 against a topic
      // left over from an earlier interrupted run instead of testing anything.
      const topicName = `Round2 TA-Owned Topic ${Date.now()}`;

      await setPolicy(adminCtx, true);
      const createRes = await taCtx.post(`${CORE_URL}/api/courses/${COURSES.cosc101}/topics`, {
        data: { name: topicName },
      });
      expect(createRes.status()).toBe(201);
      createdTopicId = (await createRes.json()).id;

      // Turn the grant back off — the docblock says a TA may still edit/delete
      // topics they personally created (own-only carve-out), independent of
      // the current policy value. Verify that actually holds.
      await setPolicy(adminCtx, false);

      const renameRes = await taCtx.patch(
        `${CORE_URL}/api/courses/${COURSES.cosc101}/topics/${createdTopicId}`,
        { data: { name: `${topicName} (renamed)` } },
      );
      expect(renameRes.status(), 'own-only carve-out should survive policy OFF').toBe(200);

      const deleteRes = await taCtx.delete(
        `${CORE_URL}/api/courses/${COURSES.cosc101}/topics/${createdTopicId}`,
        { data: { topicId: createdTopicId } },
      );
      expect(deleteRes.status()).toBe(204);
      createdTopicId = undefined; // already cleaned up

      test.info().annotations.push({
        type: 'finding',
        description:
          'canManageTopics own-only carve-out (apps/core/app/routes/api/courses.topics.$.ts) ' +
          'correctly survives a policy toggle: a topic created by a TA while tas.canManageTopics ' +
          'was ON remains editable/deletable by that same TA after the flag is turned back OFF, ' +
          'since ownership (createdBy) — not the live policy value — gates the carve-out.',
      });
    } finally {
      // Best-effort cleanup if an assertion threw before the topic was deleted.
      if (createdTopicId) {
        await adminCtx.delete(`${CORE_URL}/api/courses/${COURSES.cosc101}/topics/${createdTopicId}`, {
          data: { topicId: createdTopicId },
        }).catch(() => {});
      }
      await setPolicy(adminCtx, false);
      await adminCtx.dispose();
      await taCtx.dispose();
    }
  });

  test('policy ON: TA may manage ANY topic in the course, superseding the own-only carve-out', async ({
    playwright,
  }) => {
    const adminCtx = await newAuthedContext(playwright, USERS.admin);
    const taCtx = await newAuthedContext(playwright, USERS.taCS);
    try {
      await setPolicy(adminCtx, true);

      // seed_topic_cosc101_computational_thinking has createdBy: null (seeded
      // directly, no owner) — under the own-only carve-out alone this would
      // be 403 for a TA. With the grant ON it should be a 200.
      const renameRes = await taCtx.patch(
        `${CORE_URL}/api/courses/${COURSES.cosc101}/topics/${SEEDED_TOPIC.id}`,
        { data: { name: 'Computational Thinking (round2 temp rename)' } },
      );
      expect(renameRes.status()).toBe(200);
    } finally {
      // Restore the seeded name unconditionally — other specs (round 1's TA
      // question-creation probe) reference this topic by its original name/slug.
      await taCtx
        .patch(`${CORE_URL}/api/courses/${COURSES.cosc101}/topics/${SEEDED_TOPIC.id}`, {
          data: { name: SEEDED_TOPIC.name },
        })
        .catch(() => {});
      await setPolicy(adminCtx, false);
      await adminCtx.dispose();
      await taCtx.dispose();
    }
  });
});

// ===========================================================================
// Chat: delete, switch between threads, IDOR, rename-not-implemented
// ===========================================================================

test.describe('Chat history — delete, switch, IDOR, rename', () => {
  test('two real chats appear in the history rail and switching between them via the UI works', async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.student1);
    try {
      const chatIdA = await createFastChat(ctx, 'Round2 switch-test chat A', COURSES.cosc101);
      const chatIdB = await createFastChat(ctx, 'Round2 switch-test chat B', COURSES.cosc101);

      await injectSession(page, ctx);
      await page.goto(`${CORE_URL}/chat`);
      await page.waitForLoadState('networkidle');
      await dismissChatPrivacyNoticeIfPresent(page);

      const historyRail = page.locator('aside[aria-label="Chat history"]');
      // >= 2, not just "not 0" — the test claims both chatIdA and chatIdB
      // showed up, and the list also carries older seeded/leftover chats.
      await expect
        .poll(() => historyRail.getByRole('button').filter({ hasText: /./ }).count())
        .toBeGreaterThanOrEqual(2);

      // Direct-URL switch (what the sidebar's onSelect ultimately does via
      // navigate(`/chat/${id}`)) — confirms /chat/:chatId resolves an owned chat.
      await page.goto(`${CORE_URL}/chat/${chatIdA}`);
      await page.waitForLoadState('networkidle');
      expect(page.url()).toBe(`${CORE_URL}/chat/${chatIdA}`);

      await page.goto(`${CORE_URL}/chat/${chatIdB}`);
      await page.waitForLoadState('networkidle');
      expect(page.url()).toBe(`${CORE_URL}/chat/${chatIdB}`);

      // Clicking a row in the rail should navigate somewhere under /chat/ —
      // rows show "New conversation" for these zero-message probe chats
      // (chatHistoryRowLabel falls back to that when preview/title are unset),
      // so identify a row structurally rather than by unique text.
      const firstRow = historyRail.getByRole('button').first();
      await firstRow.waitFor({ state: 'visible', timeout: 10_000 });
      await firstRow.click();
      await page.waitForLoadState('networkidle');
      expect(page.url()).toMatch(/\/chat(\/[^/]+)?$/);

      // Cleanup so repeat runs stay deterministic.
      await ctx.delete(`${CORE_URL}/api/chats/${chatIdA}`);
      await ctx.delete(`${CORE_URL}/api/chats/${chatIdB}`);
    } finally {
      await ctx.dispose();
    }
  });

  test('delete via the UI trash button removes the chat (204) and it drops out of the list', async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.student1);
    try {
      const chatId = await createFastChat(ctx, 'Round2 delete-test chat', COURSES.cosc101);

      await injectSession(page, ctx);
      await page.goto(`${CORE_URL}/chat`);
      await page.waitForLoadState('networkidle');
      await dismissChatPrivacyNoticeIfPresent(page);

      const beforeRes = await ctx.get(`${CORE_URL}/api/chats?scope=own`);
      const beforeIds = ((await beforeRes.json()).chats ?? []).map((c: any) => c.id);
      expect(beforeIds).toContain(chatId);

      const deleteBtn = page
        .locator('aside[aria-label="Chat history"]')
        // exact: true matters — the outer row <button>'s computed accessible
        // name is "New conversation COSC 101 ... Delete conversation" (the
        // nested delete span's label gets folded into it), so a substring
        // match here would grab the row (navigates) instead of the icon
        // (deletes).
        .getByRole('button', { name: 'Delete conversation', exact: true })
        .first();
      await deleteBtn.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {
        // Delete affordance is hover-revealed (opacity-0 -> group-hover) — force
        // click if Playwright doesn't consider it independently visible.
      });
      const deleteResponsePromise = page.waitForResponse(
        (res) => res.url() === `${CORE_URL}/api/chats/${chatId}` && res.request().method() === 'DELETE',
      );
      await deleteBtn.click({ force: true });
      const deleteResponse = await deleteResponsePromise;
      expect(deleteResponse.status()).toBe(204);

      const afterRes = await ctx.get(`${CORE_URL}/api/chats?scope=own`);
      const afterIds = ((await afterRes.json()).chats ?? []).map((c: any) => c.id);
      expect(afterIds).not.toContain(chatId);

      test.info().annotations.push({
        type: 'finding',
        description:
          'Delete has no confirmation step (apps/core/app/components/chat/chat-history-list.tsx ' +
          'handleDelete fires immediately on click, no "are you sure?"). Not filed as a bug — a ' +
          'product/UX call, consistent with how this doc treats other design-tradeoff rows — but ' +
          'worth a second look since it is a destructive, irreversible, one-click action.',
      });
    } finally {
      await ctx.dispose();
    }
  });

  test('deleting a nonexistent/already-deleted chat 404s (idempotent-safe)', async ({ playwright }) => {
    const ctx = await newAuthedContext(playwright, USERS.student1);
    try {
      const res = await ctx.delete(`${CORE_URL}/api/chats/does-not-exist-round2-probe`);
      expect(res.status()).toBe(404);
    } finally {
      await ctx.dispose();
    }
  });

  test('IDOR: a TA cannot delete another user\'s chat (404, no existence leak)', async ({ playwright }) => {
    const studentCtx = await newAuthedContext(playwright, USERS.student1);
    const taCtx = await newAuthedContext(playwright, USERS.taCS);
    try {
      const chatId = await createFastChat(
        studentCtx,
        'Round2 IDOR-target chat (student1)',
        COURSES.cosc101,
      );

      const deleteAsTaRes = await taCtx.delete(`${CORE_URL}/api/chats/${chatId}`);
      expect(deleteAsTaRes.status(), 'TA deleting student1\'s chat by id').toBe(404);

      // Confirm it's still there — rules out "the 404 was because the chat
      // was already gone" as an alternative explanation for the TA's 404,
      // though it doesn't independently prove the 404 came from an
      // ownership check specifically (vs. some other non-admin-DELETE bug);
      // that's confirmed by reading chats.$chatId.ts directly instead.
      // Clean up as its real owner regardless.
      const stillThereRes = await studentCtx.get(`${CORE_URL}/api/chats?scope=own`);
      const stillThereIds = ((await stillThereRes.json()).chats ?? []).map((c: any) => c.id);
      expect(stillThereIds).toContain(chatId);

      await studentCtx.delete(`${CORE_URL}/api/chats/${chatId}`);
    } finally {
      await studentCtx.dispose();
      await taCtx.dispose();
    }
  });

  test('chat rename is not an implemented feature (PATCH -> 405, not a permission gate)', async ({
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.student1);
    try {
      const chatId = await createFastChat(ctx, 'Round2 rename-probe chat', COURSES.cosc101);
      const res = await ctx.patch(`${CORE_URL}/api/chats/${chatId}`, {
        data: { title: 'Attempted rename' },
      });
      // apps/core/app/routes/api/chats.$chatId.ts only exports a loader (GET)
      // and an action gated to DELETE — any other method 405s. This confirms
      // round 1's "known gap" framing was slightly off: rename isn't an
      // untested workflow, it's a feature that doesn't exist yet (no route,
      // no UI). Documented here, not filed as a bug or built as a feature —
      // out of scope for this pass.
      expect(res.status()).toBe(405);
      await ctx.delete(`${CORE_URL}/api/chats/${chatId}`);
    } finally {
      await ctx.dispose();
    }
  });
});

// ===========================================================================
// Bug report — full UI submission (round 1 only exercised the read side)
// ===========================================================================

test.describe('Bug report — UI submission', () => {
  test('TA submits a bug report through the dialog end-to-end, appears in their own list', async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.taCS);
    try {
      await injectSession(page, ctx);
      await skipDashboardTour(page);
      await skipStudentIdOnboarding(page);
      await page.goto(`${CORE_URL}/dashboard`);
      await page.waitForLoadState('networkidle');

      await page.getByRole('button', { name: 'Report a bug' }).click();
      await expect(page.getByRole('heading', { name: 'Report a bug' })).toBeVisible();

      await page.getByTestId('bug-type').click();
      await page.getByRole('option', { name: 'UI / display issue' }).click();

      const probeText = `Round2 e2e probe bug report ${Date.now()}`;
      await page.getByTestId('bug-description').fill(probeText);

      await page.getByRole('button', { name: 'Submit report' }).click();
      // Dialog closes on success (handleClose runs after onSubmit resolves).
      await expect(page.getByRole('heading', { name: 'Report a bug' })).not.toBeVisible({ timeout: 10_000 });

      const mineRes = await ctx.get(`${CORE_URL}/api/bug-reports?mine=true`);
      expect(mineRes.status()).toBe(200);
      const { reports } = await mineRes.json();
      const found = (reports ?? []).some((r: any) => r.description === probeText);
      expect(found, 'submitted report should appear in GET /api/bug-reports?mine=true').toBeTruthy();
    } finally {
      await ctx.dispose();
    }
  });

  test('Student: too-short description blocks submit with an inline error, dialog stays open', async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.student1);
    try {
      await injectSession(page, ctx);
      await skipDashboardTour(page);
      await skipStudentIdOnboarding(page);
      await page.goto(`${CORE_URL}/dashboard`);
      await page.waitForLoadState('networkidle');

      await page.getByRole('button', { name: 'Report a bug' }).click();
      await page.getByTestId('bug-type').click();
      await page.getByRole('option', { name: 'Other' }).click();
      await page.getByTestId('bug-description').fill('short'); // under the 10-char minimum (@eduai/ui BugReportDialog)
      await page.getByRole('button', { name: 'Submit report' }).click();

      await expect(page.getByText(/at least 10 characters/i)).toBeVisible();
      // Dialog must still be open — no request should have been sent.
      await expect(page.getByRole('heading', { name: 'Report a bug' })).toBeVisible();
    } finally {
      await ctx.dispose();
    }
  });
});

// ===========================================================================
// /help — role-based content filtering
// ===========================================================================

test.describe('/help — role-based section filtering', () => {
  test('TA: STAFF-gated and ADMIN-gated sections are hidden, despite TA having real material-upload rights', async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.taCS);
    try {
      await injectSession(page, ctx);
      await page.goto(`${CORE_URL}/help`);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('#getting-started')).toBeVisible();
      await expect(page.locator('#command-palette')).toBeVisible();
      await expect(page.locator('#courses')).toBeVisible();
      await expect(page.locator('#chat')).toBeVisible();
      await expect(page.locator('#materials')).toHaveCount(0);
      await expect(page.locator('#administration')).toHaveCount(0);

      test.info().annotations.push({
        type: 'finding',
        description:
          'apps/core/app/components/help/help-view.tsx gates the "Course materials" topic to ' +
          'STAFF = [ADMIN, UNIT_ADMIN, INSTRUCTOR] using session.user.role. A TA\'s platform role is ' +
          'STUDENT (TA status lives in Enrollment.role, per the same design already flagged for the ' +
          'dashboard identity badge and /settings student-number copy) — so a TA who genuinely has ' +
          'material-upload/rename/delete permission (AUTH-08) never sees the help content that ' +
          'explains how to use it. Same root cause as the existing dashboard-badge / #1464 rows, ' +
          'a new surface it hadn\'t been checked on yet — worth folding into that product discussion ' +
          'rather than filing as a fresh bug.',
      });
    } finally {
      await ctx.dispose();
    }
  });

  test('Student: same two gated sections hidden; general nav (tour link, courses/chat links) works', async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.student1);
    try {
      await injectSession(page, ctx);
      await page.goto(`${CORE_URL}/help`);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('#materials')).toHaveCount(0);
      await expect(page.locator('#administration')).toHaveCount(0);

      const tourLink = page.getByRole('link', { name: /replay guided tour/i });
      await expect(tourLink).toHaveAttribute('href', '/dashboard?tour=1');
    } finally {
      await ctx.dispose();
    }
  });
});

// ===========================================================================
// /settings — password change, provider API keys, admin-key gate
// ===========================================================================

test.describe('/settings — account actions', () => {
  test('password change: wrong current password shows an inline error, no mutation', async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.student1);
    try {
      await injectSession(page, ctx);
      await page.goto(`${CORE_URL}/settings`);
      await page.waitForLoadState('networkidle');

      await page.getByLabel('Current password').fill('DefinitelyWrongPassword123!');
      await page.getByLabel('New password', { exact: true }).fill('NewPassw0rd!!ZZ');
      await page.getByLabel('Confirm new password').fill('NewPassw0rd!!ZZ');
      await page.getByRole('button', { name: 'Change password' }).click();

      await expect(page.getByRole('alert')).toBeVisible({ timeout: 10_000 });

      // Confirm no mutation: the account can still sign in with the real password.
      const verifyCtx = await playwright.request.newContext();
      await apiSignIn(verifyCtx, USERS.student1);
      await verifyCtx.dispose();
    } finally {
      await ctx.dispose();
    }
  });

  test('password change: mismatched confirmation blocks submit client-side', async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.taCS);
    try {
      await injectSession(page, ctx);
      await page.goto(`${CORE_URL}/settings`);
      await page.waitForLoadState('networkidle');

      await page.getByLabel('Current password').fill(PASSWORD);
      await page.getByLabel('New password', { exact: true }).fill('SomeNewPassw0rd!!');
      await page.getByLabel('Confirm new password').fill('DoesNotMatch!!');

      await expect(page.getByText("Passwords don't match")).toBeVisible();
      await expect(page.getByRole('button', { name: 'Change password' })).toBeDisabled();
    } finally {
      await ctx.dispose();
    }
  });

  test('password change: full success path on a freshly-registered (non-seeded) user', async ({
    page,
    playwright,
  }) => {
    const ctx = await playwright.request.newContext();
    try {
      const { email, password: registeredPassword } = await registerUser(ctx, {
        prefix: 'round2-pwchange',
      });

      await injectSession(page, ctx);
      await page.goto(`${CORE_URL}/settings`);
      await page.waitForLoadState('networkidle');

      const newPassword = 'Round2NewPassw0rd!!';

      await page.getByLabel('Current password').fill(registeredPassword);
      await page.getByLabel('New password', { exact: true }).fill(newPassword);
      await page.getByLabel('Confirm new password').fill(newPassword);
      await page.getByRole('button', { name: 'Change password' }).click();

      await expect(page.getByText('Password changed successfully.')).toBeVisible({ timeout: 10_000 });

      const verifyCtx = await playwright.request.newContext();
      const res = await verifyCtx.post(`${CORE_URL}/api/auth/sign-in/email`, {
        data: { email, password: newPassword },
      });
      expect(res.ok(), 'should be able to sign in with the new password').toBeTruthy();
      await verifyCtx.dispose();
    } finally {
      await ctx.dispose();
    }
  });

  test('provider API key: add reflects hasKey, remove clears it, unknown provider 400s', async ({
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.student1);
    try {
      const upsertRes = await ctx.post(`${CORE_URL}/api/user-provider-settings`, {
        data: { providerName: 'openai', isEnabled: true, apiKey: 'sk-round2-e2e-probe-key' },
      });
      expect(upsertRes.status()).toBe(204);

      const afterAddRes = await ctx.get(`${CORE_URL}/api/user-provider-settings`);
      const afterAdd = await afterAddRes.json();
      const openaiRow = afterAdd.find((r: any) => r.providerName === 'openai');
      expect(openaiRow?.hasKey).toBe(true);
      // Raw key is never returned to the client.
      expect(JSON.stringify(afterAdd)).not.toContain('sk-round2-e2e-probe-key');

      const deleteRes = await ctx.delete(`${CORE_URL}/api/user-provider-settings`, {
        data: { providerName: 'openai' },
      });
      expect(deleteRes.status()).toBe(204);

      const afterDeleteRes = await ctx.get(`${CORE_URL}/api/user-provider-settings`);
      const afterDelete = await afterDeleteRes.json();
      const openaiRowAfter = afterDelete.find((r: any) => r.providerName === 'openai');
      expect(openaiRowAfter?.hasKey ?? false).toBe(false);

      const badProviderRes = await ctx.post(`${CORE_URL}/api/user-provider-settings`, {
        data: { providerName: 'not-a-real-provider', isEnabled: true },
      });
      expect(badProviderRes.status()).toBe(400);
    } finally {
      await ctx.dispose();
    }
  });

  test('Server API Keys admin surface is server-side gated, not just hidden client-side', async ({
    playwright,
  }) => {
    const studentCtx = await newAuthedContext(playwright, USERS.student1);
    const taCtx = await newAuthedContext(playwright, USERS.taCS);
    try {
      for (const [label, ctx] of [['student', studentCtx], ['TA', taCtx]] as const) {
        const res = await ctx.post(`${CORE_URL}/api/auth/api-key/create`, {
          data: { name: `round2-probe-${label}`, expiresIn: 86400 },
        });
        expect(res.status(), `${label} POST /api/auth/api-key/create`).toBe(403);
      }
    } finally {
      await studentCtx.dispose();
      await taCtx.dispose();
    }
  });
});

// ===========================================================================
// Course chat — deterministic (mocked) reply, both roles
// ===========================================================================

function buildMockStreamBody(text: string): string {
  return `0:${JSON.stringify(text)}\nd:${JSON.stringify({ finishReason: 'stop' })}\n`;
}

test.describe('Course chat — mocked deterministic reply', () => {
  for (const [label, email] of [
    ['Student', USERS.student1],
    ['TA', USERS.taCS],
  ] as const) {
    test(`${label}: mocked assistant reply renders in the chat UI`, async ({ page, playwright }) => {
      const ctx = await newAuthedContext(playwright, email);
      try {
        let capturedBody: any = null;
        await page.route('**/api/chat', async (route) => {
          if (route.request().method() !== 'POST') {
            await route.continue();
            return;
          }
          capturedBody = route.request().postDataJSON();
          await route.fulfill({
            status: 200,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            body: buildMockStreamBody('This is a deterministic round2 mocked reply about COSC 101.'),
          });
        });

        await injectSession(page, ctx);
        await page.goto(`${CORE_URL}/chat?courseCode=${encodeURIComponent('COSC 101')}`);
        const understand = page.getByRole('button', { name: 'I understand' });
        await understand.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
        if (await understand.count()) {
          await understand.click();
          await understand.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
        }
        const input = page.locator('#chat-message-input');
        await expect(input).toBeEnabled({ timeout: 15_000 });
        await input.fill('What is decomposition in computational thinking?');
        await page.getByRole('button', { name: 'Send message' }).click();

        await expect(
          page.getByText('This is a deterministic round2 mocked reply about COSC 101.'),
        ).toBeVisible({ timeout: 15_000 });

        test.info().annotations.push({
          type: 'finding',
          description: `${label} mocked /api/chat request body courseId=${capturedBody?.courseId ?? 'undefined'}`,
        });
      } finally {
        await ctx.dispose();
      }
    });
  }
});
