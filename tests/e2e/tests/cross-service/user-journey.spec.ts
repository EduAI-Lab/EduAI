/**
 * Cross-service user-journey E2E tests.
 *
 * Covers: the end-to-end flow where a single Core session is used to access
 * all three backends (Core, AI Tutor, Question Maker) and the session
 * invalidation cascade when signing out from any service.
 *
 * These tests are intentionally coarse-grained: they verify that the session
 * cookie issued by Core is accepted and rejected correctly across service
 * boundaries, and that a logout in any service invalidates access everywhere.
 */
import { test, expect } from '@playwright/test';
import { CORE_URL, AI_TUTOR_API_URL, QM_BACKEND_URL } from '../../playwright.config';
import {
  signUp,
  signOut,
  signIn,
  uniqueEmail,
  DEFAULT_PASSWORD,
  checkStatus,
  createInstructor,
} from '../helpers/auth';
import { createQmCourseForInstructor } from '../helpers/qm-courses';

// ---------------------------------------------------------------------------
// Session propagation — one Core sign-in unlocks all three backends
// ---------------------------------------------------------------------------

test.describe('Single session across all three services', () => {
  test('Core session cookie grants access to Core, AI Tutor, and QM simultaneously', async ({
    request,
  }) => {
    const email = uniqueEmail('journey-all');
    await signUp(request, { email, name: 'Journey User' });

    // Core
    const coreRes = await request.get(`${CORE_URL}/api/me`);
    expect(coreRes.status()).toBe(200);
    expect((await coreRes.json()).email).toBe(email);

    // AI Tutor
    const tutorRes = await request.get(`${AI_TUTOR_API_URL}/api/me`);
    expect(tutorRes.status()).toBe(200);
    expect((await tutorRes.json()).user.email).toBe(email);

    // Question Maker
    const qmRes = await request.get(`${QM_BACKEND_URL}/api/auth/me`);
    expect(qmRes.status()).toBe(200);
    expect((await qmRes.json()).user.email).toBe(email);
  });

  test('each service returns the same user identity (email, role)', async ({ request }) => {
    const email = uniqueEmail('journey-identity');
    await signUp(request, { email, name: 'Identity Check' });

    const coreBody = (await (await request.get(`${CORE_URL}/api/me`)).json()) as {
      email: string; role: string;
    };
    const tutorBody = (await (await request.get(`${AI_TUTOR_API_URL}/api/me`)).json()) as {
      user: { email: string; role: string };
    };
    const qmBody = (await (await request.get(`${QM_BACKEND_URL}/api/auth/me`)).json()) as {
      user: { email: string; role: string };
    };

    expect(coreBody.email).toBe(email);
    expect(tutorBody.user.email).toBe(email);
    expect(qmBody.user.email).toBe(email);

    // All three should agree on the role
    expect(tutorBody.user.role).toBe(coreBody.role);
    expect(qmBody.user.role).toBe(coreBody.role);
  });

  test('without a session, all three services reject with 401', async ({ request }) => {
    // No sign-in — fresh context
    const [coreStatus, tutorStatus, qmStatus] = await Promise.all([
      request.get(`${CORE_URL}/api/me`).then((r) => r.status()),
      request.get(`${AI_TUTOR_API_URL}/api/me`).then((r) => r.status()),
      request.get(`${QM_BACKEND_URL}/api/auth/me`).then((r) => r.status()),
    ]);

    expect(coreStatus).toBe(401);
    expect(tutorStatus).toBe(401);
    expect(qmStatus).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Sign-out cascade — logout via Core invalidates access everywhere
// ---------------------------------------------------------------------------

test.describe('Sign-out cascade via Core', () => {
  test('Core sign-out invalidates access on Core, AI Tutor, and QM', async ({ request }) => {
    const email = uniqueEmail('cascade-core');
    await signUp(request, { email });

    // All three work before sign-out
    expect((await request.get(`${CORE_URL}/api/me`)).status()).toBe(200);
    expect((await request.get(`${AI_TUTOR_API_URL}/api/me`)).status()).toBe(200);
    expect((await request.get(`${QM_BACKEND_URL}/api/auth/me`)).status()).toBe(200);

    await signOut(request);

    // All three reject after sign-out
    expect((await request.get(`${CORE_URL}/api/me`)).status()).toBe(401);
    expect((await request.get(`${AI_TUTOR_API_URL}/api/me`)).status()).toBe(401);
    expect((await request.get(`${QM_BACKEND_URL}/api/auth/me`)).status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Sign-out cascade — logout via extension proxies to Core
// ---------------------------------------------------------------------------

test.describe('Sign-out cascade via AI Tutor', () => {
  test('AI Tutor logout invalidates the Core session', async ({ request }) => {
    const email = uniqueEmail('cascade-tutor');
    await signUp(request, { email });

    // Sign out via AI Tutor
    const logoutRes = await request.post(`${AI_TUTOR_API_URL}/api/logout`);
    await checkStatus(logoutRes, 200, 'AI Tutor POST /api/logout');

    // Core should now reject — body shown on failure to reveal if session persists
    const afterCore = await request.get(`${CORE_URL}/api/me`);
    await checkStatus(afterCore, 401, 'Core /api/me after AI Tutor logout cascade');
    // AI Tutor itself should also reject (Core session gone)
    const afterTutor = await request.get(`${AI_TUTOR_API_URL}/api/me`);
    await checkStatus(afterTutor, 401, 'AI Tutor /api/me after logout cascade');
  });
});

test.describe('Sign-out cascade via Question Maker', () => {
  test('QM logout invalidates the Core session', async ({ request }) => {
    const email = uniqueEmail('cascade-qm');
    await signUp(request, { email });

    // Sign out via Question Maker
    const logoutRes = await request.post(`${QM_BACKEND_URL}/api/auth/logout`);
    await checkStatus(logoutRes, 200, 'QM POST /api/auth/logout');

    // Core should now reject — body shown on failure to reveal if session persists
    const afterCore = await request.get(`${CORE_URL}/api/me`);
    await checkStatus(afterCore, 401, 'Core /api/me after QM logout cascade');
    // QM itself should also reject
    const afterQM = await request.get(`${QM_BACKEND_URL}/api/auth/me`);
    await checkStatus(afterQM, 401, 'QM /api/auth/me after logout cascade');
  });
});

// ---------------------------------------------------------------------------
// Re-authentication — sign back in after logout
// ---------------------------------------------------------------------------

test.describe('Re-authentication after logout', () => {
  test('can re-access all services after signing back in to Core', async ({ request }) => {
    const email = uniqueEmail('reauth-cross');
    const { password } = await signUp(request, { email });

    await signOut(request);

    // Confirm all three are inaccessible
    expect((await request.get(`${CORE_URL}/api/me`)).status()).toBe(401);
    expect((await request.get(`${AI_TUTOR_API_URL}/api/me`)).status()).toBe(401);
    expect((await request.get(`${QM_BACKEND_URL}/api/auth/me`)).status()).toBe(401);

    // Sign back in via Core
    const signInRes = await signIn(request, { email, password });
    expect(signInRes.status()).toBe(200);

    // All three services should now be accessible again
    expect((await request.get(`${CORE_URL}/api/me`)).status()).toBe(200);
    expect((await request.get(`${AI_TUTOR_API_URL}/api/me`)).status()).toBe(200);
    expect((await request.get(`${QM_BACKEND_URL}/api/auth/me`)).status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Data isolation — each user only sees their own data
// ---------------------------------------------------------------------------

test.describe('User data isolation across services', () => {
  test('two users each see only their own QM courses', async ({ playwright }) => {
    // Each APIRequestContext has its own isolated cookie jar (no browser needed).
    const req1 = await playwright.request.newContext();
    const req2 = await playwright.request.newContext();

    try {
      // #1072: QM course creation now requires a scoped `coreCourseId`, and
      // QM's course LIST is instructor-rank-and-up only (`MIN_LIST_RANK` in
      // courseListService.js, pre-dating #1072) — a STUDENT-rank creator
      // never sees their own anchor in `GET /api/course`. Use INSTRUCTOR
      // callers so this test still exercises real list isolation: each user
      // gets their own Core-linked anchor via the shared helper (creates a
      // distinctly-named Core course, then posts the QM anchor as them).
      await createInstructor(req1, { prefix: 'isolation-u1' });
      await createInstructor(req2, { prefix: 'isolation-u2' });

      await createQmCourseForInstructor(playwright, req1, { name: 'User 1 Course' });
      await createQmCourseForInstructor(playwright, req2, { name: 'User 2 Course' });

      // Each user only sees their own courses
      const raw1 = await (await req1.get(`${QM_BACKEND_URL}/api/course`)).json();
      const raw2 = await (await req2.get(`${QM_BACKEND_URL}/api/course`)).json();

      const courses1: Array<{ name: string }> = Array.isArray(raw1) ? raw1 : raw1?.data ?? [];
      const courses2: Array<{ name: string }> = Array.isArray(raw2) ? raw2 : raw2?.data ?? [];

      expect(courses1.some((c) => c.name === 'User 1 Course')).toBe(true);
      expect(courses1.some((c) => c.name === 'User 2 Course')).toBe(false);

      expect(courses2.some((c) => c.name === 'User 2 Course')).toBe(true);
      expect(courses2.some((c) => c.name === 'User 1 Course')).toBe(false);
    } finally {
      await req1.dispose();
      await req2.dispose();
    }
  });

  test('two users see separate Core profiles', async ({ playwright }) => {
    const req1 = await playwright.request.newContext();
    const req2 = await playwright.request.newContext();

    try {
      const email1 = uniqueEmail('iso-profile-u1');
      const email2 = uniqueEmail('iso-profile-u2');
      await signUp(req1, { email: email1, name: 'User One' });
      await signUp(req2, { email: email2, name: 'User Two' });

      const me1 = await (await req1.get(`${CORE_URL}/api/me`)).json();
      const me2 = await (await req2.get(`${CORE_URL}/api/me`)).json();

      expect((me1 as { email: string }).email).toBe(email1);
      expect((me2 as { email: string }).email).toBe(email2);
      expect((me1 as { id: string }).id).not.toBe((me2 as { id: string }).id);
    } finally {
      await req1.dispose();
      await req2.dispose();
    }
  });
});
