/**
 * Core RBAC enforcement E2E tests.
 *
 * Covers endpoints not already exercised in access-control.spec.ts:
 * admin-only routes, invitation management, user listing, bug-report
 * ownership scope, and model-listing gates.
 *
 * All tests use a freshly registered STUDENT (the only role available to
 * self-registered users) and assert the expected HTTP status code.
 */
import { test, expect } from '@playwright/test';
import { CORE_URL } from '../../playwright.config';
import { signUp, uniqueEmail } from '../helpers/auth';

// ---------------------------------------------------------------------------
// Admin-only routes — STUDENT must receive 403
// ---------------------------------------------------------------------------

test.describe('Core admin-only route gates (STUDENT → 403)', () => {
  test('GET /api/users returns 403', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('rbac-users') });
    const res = await request.get(`${CORE_URL}/api/users`);
    expect(res.status()).toBe(403);
  });

  test('GET /api/ollama-models returns 403', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('rbac-ollama') });
    const res = await request.get(`${CORE_URL}/api/ollama-models`);
    expect(res.status()).toBe(403);
  });

  test('GET /api/vllm-models returns 403', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('rbac-vllm') });
    const res = await request.get(`${CORE_URL}/api/vllm-models`);
    expect(res.status()).toBe(403);
  });

  test('GET /api/admin/bug-reports returns 403', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('rbac-admin-bugs') });
    const res = await request.get(`${CORE_URL}/api/admin/bug-reports`);
    expect(res.status()).toBe(403);
  });

  test('GET /api/ai-providers returns 403', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('rbac-ai-providers') });
    const res = await request.get(`${CORE_URL}/api/ai-providers`);
    expect(res.status()).toBe(403);
  });

  test('GET /api/ai-models returns 403', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('rbac-ai-models') });
    const res = await request.get(`${CORE_URL}/api/ai-models`);
    expect(res.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Invitation management — only ADMIN / INSTRUCTOR may manage invitations
// ---------------------------------------------------------------------------

test.describe('Core invitation gates (STUDENT → 403)', () => {
  test('GET /api/invitations returns 403', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('rbac-inv-list') });
    const res = await request.get(`${CORE_URL}/api/invitations`);
    expect(res.status()).toBe(403);
  });

  test('POST /api/invitations returns 403', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('rbac-inv-create') });
    const res = await request.post(`${CORE_URL}/api/invitations`, {
      data: { email: 'target@example.com', role: 'INSTRUCTOR' },
    });
    expect(res.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Course access — STUDENT sees only enrolled courses
// ---------------------------------------------------------------------------

test.describe('Core course access gates (STUDENT unenrolled)', () => {
  test('GET /api/courses/:id for a non-existent course returns 404', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('rbac-course-id') });
    // A STUDENT with no enrollment gets 404 for any courseId (not enrolled means
    // resolveCourseAccessWithCourse finds no course matching the access filter).
    const res = await request.get(`${CORE_URL}/api/courses/nonexistent-course-id-xyz`);
    expect([403, 404]).toContain(res.status());
  });

  test('POST /api/courses is blocked for STUDENT (403)', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('rbac-no-create') });
    const res = await request.post(`${CORE_URL}/api/courses`, {
      form: {
        name: 'Unauthorized Course',
        code: 'HACK 101',
        section: '001',
        term: 'W1',
        year: '2026',
      },
    });
    expect([403, 422]).toContain(res.status());
  });
});

// ---------------------------------------------------------------------------
// Bug reports — any authenticated user may submit and view their own
// ---------------------------------------------------------------------------

test.describe('Core bug report ownership scope', () => {
  test('GET /api/bug-reports?mine=true returns 200 for any authenticated user', async ({
    request,
  }) => {
    await signUp(request, { email: uniqueEmail('rbac-bugs-mine') });
    const res = await request.get(`${CORE_URL}/api/bug-reports?mine=true`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('reports');
    expect(Array.isArray(body.reports)).toBe(true);
  });

  test('GET /api/bug-reports without mine=true returns 400', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('rbac-bugs-noparam') });
    const res = await request.get(`${CORE_URL}/api/bug-reports`);
    expect(res.status()).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Unauthenticated guard — all protected routes must reject without a session
// ---------------------------------------------------------------------------

test.describe('Core unauthenticated guard on RBAC routes', () => {
  const routes = [
    { method: 'GET',  path: '/api/users' },
    { method: 'GET',  path: '/api/ollama-models' },
    { method: 'GET',  path: '/api/vllm-models' },
    { method: 'GET',  path: '/api/invitations' },
    { method: 'POST', path: '/api/invitations' },
    { method: 'GET',  path: '/api/admin/bug-reports' },
  ];

  for (const { method, path } of routes) {
    test(`${method} ${path} returns 401 or 403 without session`, async ({ request }) => {
      const res = await request.fetch(`${CORE_URL}${path}`, { method });
      // Unauthenticated callers hit either the session gate (401) or the role
      // gate first (403), depending on route order — both are acceptable.
      expect([401, 403]).toContain(res.status());
    });
  }
});

// ---------------------------------------------------------------------------
// Role escalation — PATCH /api/me must not allow role self-promotion
// ---------------------------------------------------------------------------

test.describe('Core role escalation prevention', () => {
  test('PATCH /api/me with role=ADMIN is silently ignored', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('rbac-escalate') });

    const res = await request.patch(`${CORE_URL}/api/me`, {
      data: { name: 'Still A Student', role: 'ADMIN' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // Role must remain STUDENT despite the attempted promotion
    expect(body.role).toBe('STUDENT');
  });

  test('PATCH /api/me with role=INSTRUCTOR is silently ignored', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('rbac-escalate-inst') });

    const res = await request.patch(`${CORE_URL}/api/me`, {
      data: { name: 'Still A Student', role: 'INSTRUCTOR' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('STUDENT');
  });
});
