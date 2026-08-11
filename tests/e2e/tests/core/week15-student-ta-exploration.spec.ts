/**
 * Week 15 (#1459) — Core Student & TA end-to-end exploration.
 *
 * Claude path-finding + simulation pass for Epic #1429. Uses the seeded
 * accounts (prisma/seed.ts) rather than freshly-registered users so the
 * scenarios reflect real enrollment/TA state: multi-course students, an
 * enrolled-but-unpublished edge case (student2 in cosc211), and TAs whose
 * platform `role` is STUDENT (TA status lives in Enrollment.role).
 *
 * This file is exploratory, not a guarded regression suite — several tests
 * intentionally probe for IDOR/permission gaps and are expected to assert
 * a "should be blocked" outcome. Findings get written up in
 * docs/end-to-end-user-workflows/eduai-core-workflows.md, not here.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { CORE_URL } from '../../playwright.config';

const PASSWORD = 'EduAI2026!';

const USERS = {
  student1: 'student1@eduai.local', // Alex Patel — cosc101, cosc121, math200, data310, phys121, engl110 (all published)
  student2: 'student2@eduai.local', // Brooke Kim — cosc101, cosc121, cosc211 (UNPUBLISHED), stat300, psyo121, data310, engl110
  taCS: 'ta.cs@eduai.local',        // Sam Carter — TA in cosc101, cosc121 only. Platform role = STUDENT.
  taMath: 'ta.math@eduai.local',    // Riley Chen — TA in math200 only.
  admin: 'admin@eduai.local',
};

const COURSES = {
  cosc101: 'seed_course_cosc101', // published, student1+student2 enrolled, taCS is TA
  cosc121: 'seed_course_cosc121', // published, taCS is TA
  cosc211: 'seed_course_cosc211', // UNPUBLISHED, student2 enrolled, no TA
  math200: 'seed_course_math200', // published, taMath is TA, student1 enrolled
  hist210: 'seed_course_hist210', // published, student1/student2/taCS/taMath NOT enrolled
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

// This spec signs in as prisma/seed.ts's deterministic demo accounts (not
// freshly-registered users like the rest of tests/e2e/) because the scenarios
// need real, specific enrollment/TA state that only the seed graph sets up.
// The E2E docker stack only runs `prisma migrate deploy` on boot, not the seed
// script itself, so trigger it once here via the E2E-only /api/e2e/seed route
// (guarded the same way as /api/e2e/promote — 404s outside NODE_ENV=test).
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
// STUDENT — real UI walkthrough
// ===========================================================================

test.describe('Student (student1) — UI walkthrough', () => {
  test('dashboard shows only enrolled courses, no TA framing', async ({ page, playwright }) => {
    const ctx = await newAuthedContext(playwright, USERS.student1);
    try {
      await injectSession(page, ctx);
      await page.goto(`${CORE_URL}/dashboard`);
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: 'test-results/week15/student1-dashboard.png', fullPage: true });
      // Sanity: dashboard did not bounce back to login
      await expect(page).not.toHaveURL(/\/auth\/login/);
    } finally {
      await ctx.dispose();
    }
  });

  test('course chat: on-topic + off-topic (course-scope guardrail)', async ({ page, playwright }) => {
    const ctx = await newAuthedContext(playwright, USERS.student1);
    try {
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
      await page.getByRole('button', { name: 'Send message' }).click({ timeout: 15_000 });
      await page.waitForTimeout(15_000);
      await page.screenshot({ path: 'test-results/week15/student1-chat-ontopic.png', fullPage: true });
    } finally {
      await ctx.dispose();
    }
  });

  test('enrolled-but-unpublished course (student2/cosc211): list + direct nav', async ({
    page,
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.student2);
    try {
      const listRes = await ctx.get(`${CORE_URL}/api/courses?ids=${COURSES.cosc211}`);
      const listBody = await listRes.json();
      const inList = (listBody.data ?? []).some((c: any) => c.id === COURSES.cosc211);

      await injectSession(page, ctx);
      await page.goto(`${CORE_URL}/courses/${COURSES.cosc211}`);
      await page.waitForLoadState('networkidle');
      await page.screenshot({
        path: 'test-results/week15/student2-cosc211-unpublished-direct-nav.png',
        fullPage: true,
      });
      const bodyText = await page.locator('body').innerText();

      // Bug found + fixed in this pass: this redirect used to be a bare `/courses`
      // with zero explanation, unlike the clear "you do not have access" banner
      // shown for genuinely unrelated courses. Now carries ?access=unpublished
      // and courses.tsx renders an explanatory banner for it.
      expect(page.url()).toBe(`${CORE_URL}/courses?access=unpublished`);
      await expect(page.getByText(/isn.t published yet/i)).toBeVisible();

      test.info().annotations.push({
        type: 'finding',
        description:
          `enrolled-but-unpublished direct nav: inList(api ?ids=)=${inList}, ` +
          `finalURL=${page.url()}, bodyExcerpt="${bodyText.slice(0, 200).replace(/\n/g, ' ')}"`,
      });
    } finally {
      await ctx.dispose();
    }
  });

  test('IDOR probes: cross-course chat, enrollments, questions, chats-by-id', async ({
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.student1);
    try {
      // 1. Chat in a course student1 is NOT enrolled in (hist210)
      const chatRes = await ctx.post(`${CORE_URL}/api/chat`, {
        data: {
          messages: [{ role: 'user', content: 'hello' }],
          courseId: COURSES.hist210,
        },
      });
      test.info().annotations.push({
        type: 'finding',
        description: `POST /api/chat with unenrolled courseId (hist210) as student1 -> ${chatRes.status()}`,
      });

      // 2. Enrollment list for a course student1 is not enrolled/staff in
      const enrRes = await ctx.get(`${CORE_URL}/api/courses/${COURSES.hist210}/enrollments`);
      expect([401, 403, 404]).toContain(enrRes.status());

      // 3. Enrollment list for a course student1 IS enrolled in (as STUDENT, not staff)
      const enrOwnRes = await ctx.get(`${CORE_URL}/api/courses/${COURSES.cosc101}/enrollments`);
      test.info().annotations.push({
        type: 'finding',
        description: `GET enrollments for own enrolled course (cosc101) as STUDENT -> ${enrOwnRes.status()}`,
      });

      // 4. Questions endpoint for an enrolled course
      const qRes = await ctx.get(`${CORE_URL}/api/questions?courseId=${COURSES.cosc101}`);
      test.info().annotations.push({
        type: 'finding',
        description: `GET /api/questions?courseId=cosc101 as STUDENT (enrolled) -> ${qRes.status()}`,
      });
      if (qRes.status() === 200) {
        const body = await qRes.json();
        const items = Array.isArray(body) ? body : (body.questions ?? body.data ?? []);
        const anyAnswerLeaked = items.some((q: any) => q.answer !== undefined && q.answer !== null);
        test.info().annotations.push({
          type: 'finding',
          description: `Questions payload includes ${items.length} items; answer field present on any = ${anyAnswerLeaked}`,
        });
      }

      // 5. Admin-only route
      const usersRes = await ctx.get(`${CORE_URL}/api/users`);
      expect(usersRes.status()).toBe(403);
    } finally {
      await ctx.dispose();
    }
  });

  test('materials visibility for an enrolled course', async ({ playwright }) => {
    const ctx = await newAuthedContext(playwright, USERS.student1);
    try {
      const res = await ctx.get(`${CORE_URL}/api/courses/${COURSES.cosc101}/materials`);
      test.info().annotations.push({
        type: 'finding',
        description: `GET materials for enrolled course (cosc101) as STUDENT -> ${res.status()}`,
      });
      if (res.ok()) {
        const body = await res.json();
        test.info().annotations.push({
          type: 'finding',
          description: `Materials payload: ${JSON.stringify(body).slice(0, 300)}`,
        });
      }
    } finally {
      await ctx.dispose();
    }
  });

  test('bug reports: own vs guessing another user\'s report id', async ({ playwright }) => {
    const adminCtx = await newAuthedContext(playwright, USERS.admin);
    const studentCtx = await newAuthedContext(playwright, USERS.student1);
    try {
      const adminListRes = await adminCtx.get(`${CORE_URL}/api/admin/bug-reports`);
      const adminList = await adminListRes.json();
      const reports = Array.isArray(adminList) ? adminList : (adminList.reports ?? adminList.data ?? []);
      const someoneElsesReport = reports.find((r: any) => r.userId && r.userId !== 'seed_user_student_01');

      if (someoneElsesReport) {
        const guessRes = await studentCtx.get(`${CORE_URL}/api/bug-reports/${someoneElsesReport.id}`);
        test.info().annotations.push({
          type: 'finding',
          description: `Student fetching another user's bug report by id -> ${guessRes.status()}`,
        });
      } else {
        test.info().annotations.push({ type: 'finding', description: 'No other-user bug report found to probe.' });
      }
    } finally {
      await adminCtx.dispose();
      await studentCtx.dispose();
    }
  });
});

// ===========================================================================
// TA — real UI walkthrough
// ===========================================================================

test.describe('TA (ta.cs) — UI walkthrough', () => {
  test('dashboard reflects TA framing, not generic Student', async ({ page, playwright }) => {
    const ctx = await newAuthedContext(playwright, USERS.taCS);
    try {
      const meRes = await ctx.get(`${CORE_URL}/api/me`);
      const me = await meRes.json();
      test.info().annotations.push({
        type: 'finding',
        description: `GET /api/me for TA (ta.cs) -> platform role field = "${me.role}"`,
      });

      await injectSession(page, ctx);
      await page.goto(`${CORE_URL}/dashboard`);
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: 'test-results/week15/ta-cs-dashboard.png', fullPage: true });
    } finally {
      await ctx.dispose();
    }
  });

  test('TA course page (cosc101) vs non-TA course (math200)', async ({ page, playwright }) => {
    const ctx = await newAuthedContext(playwright, USERS.taCS);
    try {
      await injectSession(page, ctx);

      await page.goto(`${CORE_URL}/courses/${COURSES.cosc101}`);
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: 'test-results/week15/ta-cs-cosc101.png', fullPage: true });

      await page.goto(`${CORE_URL}/courses/${COURSES.math200}`);
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: 'test-results/week15/ta-cs-math200-not-ta.png', fullPage: true });
      const bodyText = await page.locator('body').innerText();
      test.info().annotations.push({
        type: 'finding',
        description: `TA (cosc only) navigating to math200 (not enrolled anywhere) -> url=${page.url()}, excerpt="${bodyText.slice(0, 200).replace(/\n/g, ' ')}"`,
      });
    } finally {
      await ctx.dispose();
    }
  });

  test('TA chat in own course + course-scope guardrail', async ({ page, playwright }) => {
    const ctx = await newAuthedContext(playwright, USERS.taCS);
    try {
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
      await input.fill('As the TA, can I see which students are struggling with algorithms_basics?');
      await page.getByRole('button', { name: 'Send message' }).click({ timeout: 15_000 });
      await page.waitForTimeout(15_000);
      await page.screenshot({ path: 'test-results/week15/ta-cs-chat.png', fullPage: true });
    } finally {
      await ctx.dispose();
    }
  });

  test('TA permission probes: questions (view w/ answers), create question, enroll, admin routes', async ({
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.taCS);
    try {
      // Can TA view questions (with answers) in their own course?
      const qRes = await ctx.get(`${CORE_URL}/api/questions?courseId=${COURSES.cosc101}`);
      test.info().annotations.push({
        type: 'finding',
        description: `GET /api/questions?courseId=cosc101 as TA -> ${qRes.status()}`,
      });
      if (qRes.ok()) {
        const body = await qRes.json();
        const items = Array.isArray(body) ? body : (body.questions ?? body.data ?? []);
        const anyAnswer = items.some((q: any) => q.answer !== undefined && q.answer !== null && q.answer !== '');
        test.info().annotations.push({
          type: 'finding',
          description: `TA questions payload: ${items.length} items, answers visible = ${anyAnswer}`,
        });
      }

      // TA in cosc101 querying questions for a course they have no relation to
      const qOtherRes = await ctx.get(`${CORE_URL}/api/questions?courseId=${COURSES.math200}`);
      test.info().annotations.push({
        type: 'finding',
        description: `GET /api/questions?courseId=math200 (TA not related to this course) -> ${qOtherRes.status()}`,
      });

      // TA creating a question (should be instructor+ only)
      const createQRes = await ctx.post(`${CORE_URL}/api/questions`, {
        data: {
          courseId: COURSES.cosc101,
          topicSlug: 'computational_thinking',
          type: 'SA',
          content: 'TA-created probe question',
          answer: 'n/a',
          difficulty: 'EASY',
          reasoningLevel: 'FACTUAL',
        },
      });
      expect([401, 403, 404, 422]).toContain(createQRes.status());

      // TA enrolling a new student (should be blocked — not a policy-granted instructor)
      const enrollRes = await ctx.post(`${CORE_URL}/api/courses/${COURSES.cosc101}/enrollments`, {
        data: { userId: 'seed_user_student_05', role: 'STUDENT' },
      });
      test.info().annotations.push({
        type: 'finding',
        description: `POST enrollments (add student) as TA in own course -> ${enrollRes.status()}`,
      });

      // TA hitting admin-only routes
      const usersRes = await ctx.get(`${CORE_URL}/api/users`);
      expect(usersRes.status()).toBe(403);
      const aiModelsRes = await ctx.get(`${CORE_URL}/api/ai-models`);
      expect(aiModelsRes.status()).toBe(403);
    } finally {
      await ctx.dispose();
    }
  });

  test('TA chat oversight: viewing course chats for own course vs unrelated course', async ({
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.taCS);
    try {
      // apps/core/app/lib/rbac/permissions.ts courseChatViewPolicyKey(): TA/STUDENT
      // hit the `default` case, which hardcodes `return 'never'` — no policy flag
      // can grant this. Expect 403 for both, including the TA's own course.
      const ownCourseChatsRes = await ctx.get(`${CORE_URL}/api/courses/${COURSES.cosc101}/chats`);
      expect(ownCourseChatsRes.status()).toBe(403);
      test.info().annotations.push({
        type: 'finding',
        description: `GET /api/courses/cosc101/chats (own TA course) as TA -> ${ownCourseChatsRes.status()} (permanently 'never' for TA tier, not policy-configurable)`,
      });

      const otherCourseChatsRes = await ctx.get(`${CORE_URL}/api/courses/${COURSES.math200}/chats`);
      expect(otherCourseChatsRes.status()).toBe(403);
      test.info().annotations.push({
        type: 'finding',
        description: `GET /api/courses/math200/chats (unrelated course) as TA -> ${otherCourseChatsRes.status()}`,
      });
    } finally {
      await ctx.dispose();
    }
  });

  test('TA own-course enrollments (200, roster) + AUTH-08 material own-upload RBAC', async ({
    playwright,
  }) => {
    const ctx = await newAuthedContext(playwright, USERS.taCS);
    try {
      // TA(C) can list peers in their own course — per courses.enrollments.ts docblock.
      const enrRes = await ctx.get(`${CORE_URL}/api/courses/${COURSES.cosc101}/enrollments`);
      expect(enrRes.status()).toBe(200);
      const enrBody = await enrRes.json();
      test.info().annotations.push({
        type: 'finding',
        description: `GET enrollments for own TA course (cosc101) -> 200, ${enrBody.enrollments?.length ?? 0} peers returned`,
      });

      // AUTH-08 (apps/core/app/lib/rbac/permissions.ts canDeleteMaterial/canRenameMaterial):
      // TA may only rename/delete materials they uploaded themselves.
      // seed_material_cosc101_overview is instructor-owned; seed_material_cosc101_notes is TA-owned.
      const renameOtherRes = await ctx.patch(
        `${CORE_URL}/api/courses/${COURSES.cosc101}/materials/seed_material_cosc101_overview`,
        { data: { title: 'Hacked title' } },
      );
      expect(renameOtherRes.status()).toBe(403);

      const renameOwnRes = await ctx.patch(
        `${CORE_URL}/api/courses/${COURSES.cosc101}/materials/seed_material_cosc101_notes`,
        { data: { title: 'COSC 101 — Computational Thinking Notes' } }, // no-op rename, same title
      );
      expect(renameOwnRes.status()).toBe(200);

      const deleteOtherRes = await ctx.delete(
        `${CORE_URL}/api/courses/${COURSES.cosc101}/materials/seed_material_cosc101_overview`,
      );
      expect(deleteOtherRes.status()).toBe(403);

      test.info().annotations.push({
        type: 'finding',
        description: `AUTH-08 own-upload RBAC verified live: TA blocked (403) renaming/deleting instructor-owned material, allowed (200) renaming own upload.`,
      });
    } finally {
      await ctx.dispose();
    }
  });

  test('mixed-role scenario: student1 promoted to TA in hist210, dashboard framing check', async ({
    page,
    playwright,
  }) => {
    const adminCtx = await newAuthedContext(playwright, USERS.admin);
    const studentCtx = await newAuthedContext(playwright, USERS.student1);
    try {
      // Enroll student1 as TA in a course where they otherwise have no relation.
      const enrollRes = await adminCtx.post(`${CORE_URL}/api/courses/${COURSES.hist210}/enrollments`, {
        data: { userId: 'seed_user_student_01', role: 'TA' },
      });
      test.info().annotations.push({
        type: 'finding',
        description: `Admin adding student1 as TA to hist210 -> ${enrollRes.status()}`,
      });

      if (enrollRes.ok()) {
        const { id: enrollmentId } = await enrollRes.json();

        await injectSession(page, studentCtx);
        await page.goto(`${CORE_URL}/dashboard`);
        await page.waitForLoadState('networkidle');
        await page.screenshot({
          path: 'test-results/week15/student1-mixed-role-ta-dashboard.png',
          fullPage: true,
        });

        // Their still-STUDENT course (cosc101) — does the shell show TA-level controls there too?
        await page.goto(`${CORE_URL}/courses/${COURSES.cosc101}`);
        await page.waitForLoadState('networkidle');
        await page.screenshot({
          path: 'test-results/week15/student1-mixed-role-cosc101-still-student.png',
          fullPage: true,
        });

        // Clean up: this mutates real seed-account state, and other tests in this
        // file assert student1 has zero relation to hist210 — remove it so repeat
        // runs stay deterministic regardless of execution order.
        await adminCtx.delete(
          `${CORE_URL}/api/courses/${COURSES.hist210}/enrollments/${enrollmentId}`,
        );
      }
    } finally {
      await adminCtx.dispose();
      await studentCtx.dispose();
    }
  });
});
