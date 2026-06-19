/**
 * Question Maker backend RBAC enforcement E2E tests.
 *
 * Covers role gates beyond the basic happy-path tests in access.spec.ts:
 * question authoring (AUTHORS = INSTRUCTOR/TA/ADMIN, no STUDENT),
 * assessment CRUD (INSTRUCTORS = INSTRUCTOR/ADMIN, no TA/STUDENT for writes),
 * and course-level access (any authenticated user).
 *
 * Auth model: Core session cookie forwarded from Playwright's shared cookie jar
 * to the QM backend at port 8000. STUDENT is the only role available to
 * self-registered users in the E2E environment.
 */
import { test, expect } from '@playwright/test';
import { QM_BACKEND_URL } from '../../playwright.config';
import { signUp, uniqueEmail } from '../helpers/auth';

// ---------------------------------------------------------------------------
// Question routes — blocked for STUDENT (requires AUTHORS role)
// ---------------------------------------------------------------------------

test.describe('QM question route gates (STUDENT → 403)', () => {
  test('GET /api/questions returns 403', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('qm-rbac-q-list') });
    const res = await request.get(`${QM_BACKEND_URL}/api/questions`);
    expect(res.status()).toBe(403);
  });

  test('POST /api/questions returns 403', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('qm-rbac-q-create') });
    const res = await request.post(`${QM_BACKEND_URL}/api/questions`, {
      data: {
        description: 'Sneaky question',
        courseId: 1,
        primaryTopicId: 1,
        type: 'MCQ',
      },
    });
    expect(res.status()).toBe(403);
  });

  test('GET /api/questions/:id returns 403 for STUDENT', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('qm-rbac-q-get') });
    const res = await request.get(`${QM_BACKEND_URL}/api/questions/99999`);
    expect([403, 404]).toContain(res.status());
  });
});

// ---------------------------------------------------------------------------
// Assessment routes — blocked for STUDENT (requires AUTHORS for reads,
// INSTRUCTORS for writes)
// ---------------------------------------------------------------------------

test.describe('QM assessment route gates (STUDENT → 403)', () => {
  test('GET /api/assessments returns 403', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('qm-rbac-a-list') });
    const res = await request.get(`${QM_BACKEND_URL}/api/assessments`);
    expect(res.status()).toBe(403);
  });

  test('POST /api/assessments returns 403', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('qm-rbac-a-create') });
    const res = await request.post(`${QM_BACKEND_URL}/api/assessments`, {
      data: { title: 'Sneaky Assessment', courseId: 1 },
    });
    expect(res.status()).toBe(403);
  });

  test('GET /api/assessments/:id returns 403 for STUDENT', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('qm-rbac-a-get') });
    const res = await request.get(`${QM_BACKEND_URL}/api/assessments/99999`);
    expect([403, 404]).toContain(res.status());
  });

  test('GET /api/assessments/:id/questions returns 403 for STUDENT', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('qm-rbac-a-q-list') });
    const res = await request.get(`${QM_BACKEND_URL}/api/assessments/99999/questions`);
    expect([403, 404]).toContain(res.status());
  });
});

// ---------------------------------------------------------------------------
// Course routes — open to all authenticated users
// ---------------------------------------------------------------------------

test.describe('QM course routes accessible to all authenticated users', () => {
  test('GET /api/course returns 200 for STUDENT', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('qm-rbac-course-list') });
    const res = await request.get(`${QM_BACKEND_URL}/api/course`);
    expect(res.status()).toBe(200);
  });

  test('POST /api/course allows STUDENT to create a course (201)', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('qm-rbac-course-create') });
    const res = await request.post(`${QM_BACKEND_URL}/api/course`, {
      data: { name: 'STUDENT Created Course', courseCode: 'RBAC 200' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('STUDENT Created Course');
  });

  test('GET /api/course/:id for own course returns 200 for STUDENT', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('qm-rbac-course-own') });

    const createRes = await request.post(`${QM_BACKEND_URL}/api/course`, {
      data: { name: 'Own Course', courseCode: 'OWN 101' },
    });
    const created = await createRes.json();
    const courseId = created.data.id;

    const res = await request.get(`${QM_BACKEND_URL}/api/course/${courseId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data?.name ?? body.name).toBe('Own Course');
  });
});

// ---------------------------------------------------------------------------
// Unauthenticated guard on RBAC routes
// ---------------------------------------------------------------------------

test.describe('QM unauthenticated guard on RBAC routes', () => {
  const routes = [
    { method: 'GET',  path: '/api/questions' },
    { method: 'POST', path: '/api/questions' },
    { method: 'GET',  path: '/api/assessments' },
    { method: 'POST', path: '/api/assessments' },
    { method: 'GET',  path: '/api/course' },
    { method: 'POST', path: '/api/course' },
  ];

  for (const { method, path } of routes) {
    test(`${method} ${path} returns 401 without session`, async ({ request }) => {
      const res = await request.fetch(`${QM_BACKEND_URL}${path}`, { method });
      expect(res.status()).toBe(401);
    });
  }
});

// ---------------------------------------------------------------------------
// Cross-user isolation — one user cannot access another's courses
// ---------------------------------------------------------------------------

test.describe('QM cross-user data isolation', () => {
  test("STUDENT cannot read another user's QM course by ID", async ({ playwright }) => {
    const req1 = await playwright.request.newContext();
    const req2 = await playwright.request.newContext();

    try {
      await signUp(req1, { email: uniqueEmail('qm-iso-owner') });
      await signUp(req2, { email: uniqueEmail('qm-iso-other') });

      // User 1 creates a course
      const createRes = await req1.post(`${QM_BACKEND_URL}/api/course`, {
        data: { name: 'Owner Course', courseCode: 'ISO 101' },
      });
      const { data: course } = await createRes.json();

      // User 2 tries to access User 1's course by ID
      const res = await req2.get(`${QM_BACKEND_URL}/api/course/${course.id}`);
      // Ownership check must deny access: 403 or 404
      expect([403, 404]).toContain(res.status());
    } finally {
      await req1.dispose();
      await req2.dispose();
    }
  });
});
