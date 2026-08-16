/**
 * Question Maker backend access E2E tests.
 *
 * Covers: health endpoints, authentication rejection for unauthenticated
 * callers, and correct session propagation from Core to the QM backend.
 *
 * Auth model: QM has no own sign-in flow; like AI Tutor it validates every
 * request by forwarding the caller's cookie to Core's
 * POST /api/sessions/validate. A valid Core session cookie is sufficient.
 *
 * Cookie propagation: Better Auth sets the session cookie for domain
 * `localhost`, so Playwright automatically includes it in requests to
 * any `localhost:*` origin, including QM on port 8000.
 */
import { test, expect } from '@playwright/test';
import { CORE_URL, QM_BACKEND_URL } from '../../playwright.config';
import { signUp, signOut, uniqueEmail, checkStatus, createInstructor } from '../helpers/auth';
import { createQmCourseForInstructor } from '../helpers/qm-courses';

// ---------------------------------------------------------------------------
// Health / smoke
// ---------------------------------------------------------------------------

test.describe('Question Maker backend health', () => {
  test('GET /healthz returns 200 ok', async ({ request }) => {
    const res = await request.get(`${QM_BACKEND_URL}/healthz`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  test('GET / returns API status JSON', async ({ request }) => {
    const res = await request.get(`${QM_BACKEND_URL}/`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body).toHaveProperty('message');
  });

  test('unknown route returns 404 JSON with success=false', async ({ request }) => {
    const res = await request.get(`${QM_BACKEND_URL}/api/does-not-exist-xyz`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Authentication gates — unauthenticated callers must be rejected
// ---------------------------------------------------------------------------

test.describe('Unauthenticated access to Question Maker', () => {
  const unauthRoutes = [
    { method: 'GET',  path: '/api/auth/me' },
    { method: 'GET',  path: '/api/course' },
    { method: 'GET',  path: '/api/questions' },
    { method: 'POST', path: '/api/questions' },
  ];

  for (const { method, path } of unauthRoutes) {
    test(`${method} ${path} returns 401`, async ({ request }) => {
      const res = await request.fetch(`${QM_BACKEND_URL}${path}`, { method });
      expect(res.status()).toBe(401);
    });
  }
});

// ---------------------------------------------------------------------------
// Authenticated access — Core session forwarded to QM
// ---------------------------------------------------------------------------

test.describe('Authenticated access to Question Maker via Core session', () => {
  test('GET /api/auth/me returns the authenticated user with isBugReportAdmin', async ({
    request,
  }) => {
    const email = uniqueEmail('qm-me');
    await signUp(request, { email, name: 'QM User' });

    const res = await request.get(`${QM_BACKEND_URL}/api/auth/me`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('user');
    expect(body.user.email).toBe(email);
    expect(body.user).not.toHaveProperty('password');
    // STUDENT is not a bug-report admin
    expect(body.user.isBugReportAdmin).toBe(false);
  });

  test('GET /api/course returns an empty array for a new user (no demo seeding)', async ({
    request,
  }) => {
    await signUp(request, { email: uniqueEmail('qm-courses') });

    const res = await request.get(`${QM_BACKEND_URL}/api/course?page=1&pageSize=100`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    // Success envelope or direct array
    const list = Array.isArray(body) ? body : body?.data;
    expect(Array.isArray(list)).toBe(true);
    // #1072: QM no longer seeds demo courses on first login — every course is
    // a caller-scoped anchor to a real Core course, created explicitly.
    expect(list.length).toBe(0);
    // #1044: `data` stays a bare array, with pagination metadata as siblings.
    expect(body).toMatchObject({ page: 1, pageSize: 100, total: 0 });
  });

  test('GET /api/course requires pagination params (400 PAGINATION_REQUIRED)', async ({
    request,
  }) => {
    await signUp(request, { email: uniqueEmail('qm-courses-nopage') });

    // #1044: this list is unbounded, so page/pageSize are mandatory rather
    // than defaulted — omitting them is a client error, not a full dump.
    const res = await request.get(`${QM_BACKEND_URL}/api/course`);
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('PAGINATION_REQUIRED');
  });

  test('GET /api/questions is blocked for STUDENT (403)', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('qm-questions') });

    // STUDENT role cannot list all questions — requires INSTRUCTOR or higher
    const res = await request.get(`${QM_BACKEND_URL}/api/questions`);
    expect(res.status()).toBe(403);
  });

  test('POST /api/course without coreCourseId returns 400', async ({ request }) => {
    // #1114: STUDENT is rejected by requireRole before body validation — use
    // an instructor so we reach the coreCourseId required check.
    await createInstructor(request, { prefix: 'qm-create-missing' });

    const res = await request.post(`${QM_BACKEND_URL}/api/course`, {
      data: { name: 'E2E Test Course', courseCode: 'E2E 101' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  test('POST /api/course with an unscoped coreCourseId returns 403', async ({ request }) => {
    await createInstructor(request, { prefix: 'qm-create-unscoped' });

    // A syntactically plausible Core course id the caller has no access to
    // (not enrolled/teaching, not ADMIN) — isCoreCourseInScopedList rejects it.
    const res = await request.post(`${QM_BACKEND_URL}/api/course`, {
      data: { coreCourseId: 'nonexistent-or-unauthorized-course-id' },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('CORE_COURSE_NOT_AUTHORIZED');
  });

  test('can create a QM course anchor for a Core course the caller teaches, and retrieve it', async ({
    request,
    playwright,
  }) => {
    await createInstructor(request, { prefix: 'qm-create-course' });

    const { coreCourseId, qmCourseId } = await createQmCourseForInstructor(playwright, request, {
      name: 'E2E Test Course',
      code: 'E2E 101',
    });

    expect(typeof qmCourseId).toBe('number');

    const listRes = await request.get(`${QM_BACKEND_URL}/api/course?page=1&pageSize=100`);
    expect(listRes.status()).toBe(200);
    const listBody = await listRes.json();
    const list = Array.isArray(listBody) ? listBody : listBody?.data;
    expect(list.some((c: any) => c.id === qmCourseId && c.coreCourseId === coreCourseId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Session invalidation — QM logout proxies to Core
// ---------------------------------------------------------------------------

test.describe('Question Maker sign-out', () => {
  test('POST /api/auth/logout proxies sign-out to Core and invalidates the session', async ({
    request,
  }) => {
    const email = uniqueEmail('qm-logout');
    await signUp(request, { email });

    // Confirm authenticated on QM before logout
    const beforeQM = await request.get(`${QM_BACKEND_URL}/api/auth/me`);
    expect(beforeQM.status()).toBe(200);

    // Sign out via QM (it proxies to Core)
    const logoutRes = await request.post(`${QM_BACKEND_URL}/api/auth/logout`);
    await checkStatus(logoutRes, 200, 'QM POST /api/auth/logout');
    expect((await logoutRes.json()).ok).toBe(true);

    // Core session should now be invalid — include body so CI shows if a
    // session is still active (e.g. sign-out did not reach Core)
    const afterCore = await request.get(`${CORE_URL}/api/me`);
    await checkStatus(afterCore, 401, 'Core /api/me after QM logout');
  });

  test('logout without an active session returns ok (idempotent)', async ({ request }) => {
    const res = await request.post(`${QM_BACKEND_URL}/api/auth/logout`);
    expect(res.status()).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RBAC within Question Maker
// ---------------------------------------------------------------------------

test.describe('Question Maker RBAC', () => {
  test('STUDENT cannot create questions (403)', async ({ request }) => {
    const email = uniqueEmail('qm-no-questions');
    await signUp(request, { email });

    // No course setup needed: the AUTHORS role guard fires before any DB
    // access, so a literal courseId is enough (#1072 dropped local-only
    // course creation, so POSTing {name} here would 400 before we even
    // reach the assertion under test).
    const res = await request.post(`${QM_BACKEND_URL}/api/questions`, {
      data: {
        description: 'Test question',
        courseId: 1,
        primaryTopicId: 1,
        type: 'MCQ',
      },
    });
    // STUDENT → 403 (role guard fires before any DB access)
    expect(res.status()).toBe(403);
  });

  test('assessment routes reject STUDENT (403)', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('qm-no-assessments') });

    const res = await request.post(`${QM_BACKEND_URL}/api/assessments`, {
      data: { title: 'Sneaky Assessment', courseId: 1 },
    });
    expect(res.status()).toBe(403);
  });
});
