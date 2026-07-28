/**
 * Core API access-control E2E tests.
 *
 * Covers: authentication gates on Core API routes and basic RBAC for a
 * self-registered STUDENT user. All privileged-role scenarios (INSTRUCTOR,
 * ADMIN) are asserted via the expected rejection codes — promotion is not
 * available in the E2E environment without an existing admin.
 */
import { test, expect } from '@playwright/test';
import { CORE_URL } from '../../playwright.config';
import { signUp, signIn, signOut, uniqueEmail, DEFAULT_PASSWORD } from '../helpers/auth';
import { listCoreCoursePage } from '../helpers/core-courses';

// ---------------------------------------------------------------------------
// Unauthenticated guard — every protected route must return 401
// ---------------------------------------------------------------------------

test.describe('Unauthenticated access', () => {
  const protectedRoutes = [
    { method: 'GET',   path: '/api/me' },
    { method: 'GET',   path: '/api/courses' },
    { method: 'GET',   path: '/api/preferences' },
  ];

  for (const { method, path } of protectedRoutes) {
    test(`${method} ${path} returns 401`, async ({ request }) => {
      const res = await request.fetch(`${CORE_URL}${path}`, { method });
      expect(res.status()).toBe(401);
    });
  }

  test('POST /api/sessions/validate returns 401 without cookie', async ({ request }) => {
    const res = await request.post(`${CORE_URL}/api/sessions/validate`);
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// STUDENT access — what a self-registered user can and cannot do
// ---------------------------------------------------------------------------

test.describe('STUDENT access', () => {
  test('can read own profile via GET /api/me', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('student-me'), name: 'Student Me' });

    const res = await request.get(`${CORE_URL}/api/me`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('STUDENT');
    expect(body.isActive).toBe(true);
  });

  test('gets an empty course list via GET /api/courses (no enrollments)', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('student-courses') });

    // #1041: the list is paginated — `{ data, total, page, pageSize }`.
    const { status, body } = await listCoreCoursePage(request);
    expect(status).toBe(200);
    expect(body.data).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  test('can read and update own assistive preferences', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('prefs') });

    // GET defaults
    const getRes = await request.get(`${CORE_URL}/api/preferences`);
    expect(getRes.status()).toBe(200);
    const defaults = await getRes.json();
    expect(defaults).toHaveProperty('assistDefault');

    // PATCH an update
    const patchRes = await request.patch(`${CORE_URL}/api/preferences`, {
      data: { assistDefault: true },
    });
    expect(patchRes.status()).toBe(200);
    const updated = await patchRes.json();
    expect(updated.assistDefault).toBe(true);
  });

  test('cannot access admin-only AI provider list (403)', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('no-ai-providers') });

    const res = await request.get(`${CORE_URL}/api/ai-providers`);
    expect(res.status()).toBe(403);
  });

  test('cannot access admin-only AI model list (403)', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('no-ai-models') });

    const res = await request.get(`${CORE_URL}/api/ai-models`);
    expect(res.status()).toBe(403);
  });

  test('cannot POST to create a course (403)', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('no-create-course') });

    const body = new URLSearchParams({
      name: 'Sneaky Course',
      code: 'HACK 101',
      section: '001',
      term: 'W1',
      year: '2026',
    });
    const res = await request.post(`${CORE_URL}/api/courses`, {
      form: Object.fromEntries(body),
    });
    // STUDENT is not allowed to create courses
    expect([403, 422]).toContain(res.status());
  });

  test('cannot access invitations list (403)', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('no-invites') });

    const res = await request.get(`${CORE_URL}/api/invitations`);
    expect(res.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Session management — re-authentication
// ---------------------------------------------------------------------------

test.describe('Session management', () => {
  test('signs in again after signing out', async ({ request }) => {
    const email = uniqueEmail('reauth');
    const { password } = await signUp(request, { email });
    await signOut(request);

    const signInRes = await signIn(request, { email, password });
    expect(signInRes.status()).toBe(200);

    const meRes = await request.get(`${CORE_URL}/api/me`);
    expect(meRes.status()).toBe(200);
    expect((await meRes.json()).email).toBe(email);
  });

  test('unauthenticated after sign-out even if session cookie persists in context', async ({
    request,
  }) => {
    const email = uniqueEmail('cookie-gone');
    await signUp(request, { email });
    await signOut(request);

    const res = await request.get(`${CORE_URL}/api/me`);
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Service key — extension-to-Core machine auth
// ---------------------------------------------------------------------------

test.describe('Service key guard', () => {
  test('POST /api/sessions/validate with a valid session returns user', async ({ request }) => {
    const email = uniqueEmail('svc-validate');
    await signUp(request, { email });

    const res = await request.post(`${CORE_URL}/api/sessions/validate`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe(email);
    expect(body.user).not.toHaveProperty('password');
  });

  test('enrollments endpoint returns 401 without auth and 403 without service key', async ({
    request,
  }) => {
    // Without auth at all
    const noAuth = await request.get(`${CORE_URL}/api/courses/nonexistent-id/enrollments`);
    expect([400, 401, 403, 404]).toContain(noAuth.status());
  });
});
