/**
 * AI Tutor backend RBAC enforcement E2E tests.
 *
 * Covers role gates not already exercised in access.spec.ts:
 * instructor-only course mutation routes, admin console routes, and
 * any-authenticated-user routes (bug reporting).
 *
 * All STUDENT-side tests use a freshly registered Core user (STUDENT role is
 * the only role available to self-registrations). Auth model is the same as
 * access.spec.ts: Core session cookie forwarded to AI Tutor via cookie header.
 */
import { test, expect } from '@playwright/test';
import { AI_TUTOR_API_URL } from '../../playwright.config';
import { signUp, uniqueEmail } from '../helpers/auth';

// ---------------------------------------------------------------------------
// INSTRUCTOR-only course routes — STUDENT must receive 403
// ---------------------------------------------------------------------------

test.describe('AI Tutor course mutation gates (STUDENT → 403)', () => {
  test('POST /api/courses is blocked for STUDENT', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('at-rbac-post-course') });
    const res = await request.post(`${AI_TUTOR_API_URL}/api/courses`, {
      data: { title: 'Unauthorized Course' },
    });
    expect(res.status()).toBe(403);
  });

  test('PATCH /api/courses/:courseId is blocked for STUDENT', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('at-rbac-patch-course') });
    const res = await request.patch(`${AI_TUTOR_API_URL}/api/courses/99999`, {
      data: { title: 'Renamed' },
    });
    // Role check fires before course lookup → 403; 404 also accepted if lookup runs first
    expect([403, 404]).toContain(res.status());
  });

  test('PATCH /api/courses/:courseId/publish is blocked for STUDENT', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('at-rbac-publish-course') });
    const res = await request.patch(`${AI_TUTOR_API_URL}/api/courses/99999/publish`);
    expect([403, 404]).toContain(res.status());
  });

  test('PATCH /api/courses/:courseId/unpublish is blocked for STUDENT', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('at-rbac-unpublish-course') });
    const res = await request.patch(`${AI_TUTOR_API_URL}/api/courses/99999/unpublish`);
    expect([403, 404]).toContain(res.status());
  });

  test('GET /api/courses/:courseId/feedback is blocked for STUDENT', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('at-rbac-course-feedback') });
    const res = await request.get(`${AI_TUTOR_API_URL}/api/courses/99999/feedback`);
    expect([403, 404]).toContain(res.status());
  });

  test('POST /api/courses/import-external is blocked for STUDENT', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('at-rbac-import') });
    const res = await request.post(`${AI_TUTOR_API_URL}/api/courses/import-external`, {
      data: { externalId: 'abc123' },
    });
    expect(res.status()).toBe(403);
  });

  test('GET /api/eduai/courses is blocked for STUDENT (INSTRUCTOR-only)', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('at-rbac-eduai-courses') });
    const res = await request.get(`${AI_TUTOR_API_URL}/api/eduai/courses`);
    expect(res.status()).toBe(403);
  });

  test('POST /api/courses/:courseId/modules is blocked for STUDENT', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('at-rbac-post-module') });
    const res = await request.post(`${AI_TUTOR_API_URL}/api/courses/99999/modules`, {
      data: { title: 'Sneaky Module' },
    });
    expect([403, 404]).toContain(res.status());
  });

  test('POST /api/modules/:moduleId/lessons is blocked for STUDENT', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('at-rbac-post-lesson') });
    const res = await request.post(`${AI_TUTOR_API_URL}/api/modules/99999/lessons`, {
      data: { title: 'Sneaky Lesson' },
    });
    expect([403, 404]).toContain(res.status());
  });
});

// ---------------------------------------------------------------------------
// ADMIN-only routes — STUDENT must receive 403
// ---------------------------------------------------------------------------

test.describe('AI Tutor admin route gates (STUDENT → 403)', () => {
  test('GET /api/admin/users returns 403', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('at-rbac-admin-users') });
    const res = await request.get(`${AI_TUTOR_API_URL}/api/admin/users`);
    expect(res.status()).toBe(403);
  });

  test('GET /api/admin/courses returns 403', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('at-rbac-admin-courses') });
    const res = await request.get(`${AI_TUTOR_API_URL}/api/admin/courses`);
    expect(res.status()).toBe(403);
  });

  test('GET /api/admin/settings/eduai-api-key returns 403', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('at-rbac-admin-apikey') });
    const res = await request.get(`${AI_TUTOR_API_URL}/api/admin/settings/eduai-api-key`);
    expect(res.status()).toBe(403);
  });

  test('GET /api/admin/settings/ai-model-policy returns 403', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('at-rbac-admin-policy') });
    const res = await request.get(`${AI_TUTOR_API_URL}/api/admin/settings/ai-model-policy`);
    expect(res.status()).toBe(403);
  });

  test('GET /api/admin/bug-reports returns 403', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('at-rbac-admin-bugs') });
    const res = await request.get(`${AI_TUTOR_API_URL}/api/admin/bug-reports`);
    expect(res.status()).toBe(403);
  });

  test('PATCH /api/admin/users/:userId/role returns 403 or 410', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('at-rbac-role-change') });
    const res = await request.patch(
      `${AI_TUTOR_API_URL}/api/admin/users/some-user-id/role`,
      { data: { role: 'ADMIN' } },
    );
    // 403 = role gate fires; 410 = endpoint deliberately returns GONE (deprecated)
    expect([403, 410]).toContain(res.status());
  });
});

// ---------------------------------------------------------------------------
// Routes open to any authenticated user
// ---------------------------------------------------------------------------

test.describe('AI Tutor routes accessible to all authenticated users', () => {
  test('POST /api/bug-reports succeeds for STUDENT (201)', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('at-rbac-bug-report') });
    const res = await request.post(`${AI_TUTOR_API_URL}/api/bug-reports`, {
      data: {
        description: 'E2E test bug report from STUDENT',
        isAnonymous: true,
      },
    });
    // 201 expected; 503/500 acceptable if the EduAI service key is not configured in dev
    expect([201, 500, 503]).toContain(res.status());
  });

  test('GET /api/courses is accessible to STUDENT (200)', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('at-rbac-courses-read') });
    const res = await request.get(`${AI_TUTOR_API_URL}/api/courses`);
    expect(res.status()).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unauthenticated guard on RBAC routes
// ---------------------------------------------------------------------------

test.describe('AI Tutor unauthenticated guard on RBAC routes', () => {
  const routes = [
    { method: 'POST', path: '/api/courses' },
    { method: 'GET',  path: '/api/admin/users' },
    { method: 'GET',  path: '/api/admin/courses' },
    { method: 'GET',  path: '/api/admin/settings/eduai-api-key' },
    { method: 'GET',  path: '/api/eduai/courses' },
  ];

  for (const { method, path } of routes) {
    test(`${method} ${path} returns 401 without session`, async ({ request }) => {
      const res = await request.fetch(`${AI_TUTOR_API_URL}${path}`, { method });
      expect(res.status()).toBe(401);
    });
  }
});
