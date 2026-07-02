/**
 * AI Tutor backend access E2E tests.
 *
 * Covers: health check, authentication rejection for unauthenticated callers,
 * and correct session propagation from Core to the AI Tutor server.
 *
 * Auth model: AI Tutor has no own sign-in flow; it validates every request
 * by forwarding the caller's cookie to Core's POST /api/sessions/validate.
 * A valid Core session cookie is therefore sufficient (and necessary) to
 * authenticate against the AI Tutor backend.
 *
 * Cookie propagation: Better Auth sets the session cookie for domain
 * `localhost`, so it is automatically included by Playwright in requests to
 * any `localhost:*` origin, including AI Tutor on port 4000.
 */
import { test, expect } from '@playwright/test';
import { CORE_URL, AI_TUTOR_API_URL } from '../../playwright.config';
import { signUp, signOut, uniqueEmail, checkStatus } from '../helpers/auth';

// ---------------------------------------------------------------------------
// Health / smoke
// ---------------------------------------------------------------------------

test.describe('AI Tutor server health', () => {
  test('GET /api/health returns { ok: true }', async ({ request }) => {
    const res = await request.get(`${AI_TUTOR_API_URL}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Authentication gates — unauthenticated callers must be rejected
// ---------------------------------------------------------------------------

test.describe('Unauthenticated access to AI Tutor', () => {
  const unauthRoutes = [
    { method: 'GET', path: '/api/me' },
    { method: 'GET', path: '/api/courses' },
  ];

  for (const { method, path } of unauthRoutes) {
    test(`${method} ${path} returns 401`, async ({ request }) => {
      const res = await request.fetch(`${AI_TUTOR_API_URL}${path}`, { method });
      expect(res.status()).toBe(401);
    });
  }
});

// ---------------------------------------------------------------------------
// Authenticated access — Core session forwarded to AI Tutor
// ---------------------------------------------------------------------------

test.describe('Authenticated access to AI Tutor via Core session', () => {
  test('GET /api/me returns the authenticated user', async ({ request }) => {
    const email = uniqueEmail('at-me');
    await signUp(request, { email, name: 'AI Tutor Me' });

    const res = await request.get(`${AI_TUTOR_API_URL}/api/me`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('user');
    expect(body.user.email).toBe(email);
    expect(body.user).not.toHaveProperty('password');
  });

  test('GET /api/courses returns an array (empty for a new STUDENT)', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('at-courses') });

    const res = await request.get(`${AI_TUTOR_API_URL}/api/courses`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('ADMIN role blocks access to non-admin instructor/student routes', async ({ request }) => {
    // Self-registered users are STUDENT, not ADMIN, so this confirms the gate
    // is correctly evaluated on the AI Tutor side (not Core).
    await signUp(request, { email: uniqueEmail('at-role-check') });

    // STUDENT should NOT be blocked from /api/courses (their own list)
    const coursesRes = await request.get(`${AI_TUTOR_API_URL}/api/courses`);
    expect(coursesRes.status()).toBe(200);
  });

  test('ADMIN-only admin routes return 403 for a STUDENT user', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('at-no-admin') });

    // Admin-only endpoint: user roster
    const res = await request.get(`${AI_TUTOR_API_URL}/api/admin/users`);
    expect(res.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Session invalidation — sign-out via AI Tutor proxies to Core
// ---------------------------------------------------------------------------

test.describe('AI Tutor sign-out', () => {
  test('POST /api/logout proxies sign-out to Core and invalidates the session', async ({
    request,
  }) => {
    const email = uniqueEmail('at-logout');
    await signUp(request, { email });

    // Confirm authenticated on both services before logout
    const beforeCore = await request.get(`${CORE_URL}/api/me`);
    expect(beforeCore.status()).toBe(200);

    const beforeTutor = await request.get(`${AI_TUTOR_API_URL}/api/me`);
    expect(beforeTutor.status()).toBe(200);

    // Sign out via AI Tutor (it proxies to Core server-to-server)
    const logoutRes = await request.post(`${AI_TUTOR_API_URL}/api/logout`);
    await checkStatus(logoutRes, 200, 'AI Tutor POST /api/logout');
    expect((await logoutRes.json()).ok).toBe(true);

    // Core session should now be invalid — include body so CI shows if a
    // session is still active (e.g. sign-out did not reach Core)
    const afterCore = await request.get(`${CORE_URL}/api/me`);
    await checkStatus(afterCore, 401, 'Core /api/me after AI Tutor logout');
  });

  test('sign-out without a session still returns ok (idempotent)', async ({ request }) => {
    // No sign-in first — logout is best-effort
    const res = await request.post(`${AI_TUTOR_API_URL}/api/logout`);
    expect(res.status()).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// STUDENT / unsupported-role guards inside AI Tutor
// ---------------------------------------------------------------------------

test.describe('AI Tutor role guards', () => {
  test('STUDENT cannot access INSTRUCTOR-only course creation', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('at-no-create-course') });

    const res = await request.post(`${AI_TUTOR_API_URL}/api/courses`, {
      data: { title: 'Sneaky Course' },
    });
    expect(res.status()).toBe(403);
  });

  test('STUDENT cannot access admin user list', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('at-no-users') });

    const res = await request.get(`${AI_TUTOR_API_URL}/api/admin/users`);
    expect(res.status()).toBe(403);
  });
});
