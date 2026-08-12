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
import { signUp, uniqueEmail, createInstructor } from '../helpers/auth';
import { createQmCourseForInstructor } from '../helpers/qm-courses';

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
// Course routes — list/create open to any authenticated user; per-course
// read/edit is gated by access resolved against the caller's REAL Core
// enrollment role for the linked course (#1072) — NOT QM ownership. Every QM
// course is Core-linked at creation time now (local-only "sandbox" creation
// is retired), so the old "owner always resolves to instructor" fallback in
// `resolveAccessForCourse` (courseAccess.js) only still applies to the
// unreachable case of a never-linked row; a fresh anchor's owner gets
// whatever rank their actual Core enrollment carries.
// ---------------------------------------------------------------------------

test.describe('QM course routes accessible to all authenticated users', () => {
  test('GET /api/course returns 200 for STUDENT', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('qm-rbac-course-list') });
    // Pagination params are required on this list (#1044).
    const res = await request.get(`${QM_BACKEND_URL}/api/course?page=1&pageSize=100`);
    expect(res.status()).toBe(200);
  });

  test('STUDENT enrolled in a Core course cannot create a QM anchor for it (403)', async ({
    request,
  }) => {
    await signUp(request, { email: uniqueEmail('qm-rbac-course-create') });

    // #1114: only ADMIN / UNIT_ADMIN / INSTRUCTOR may materialize anchors.
    const res = await request.post(`${QM_BACKEND_URL}/api/course`, {
      data: { coreCourseId: 'any-core-course-id' },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(String(body.error)).toMatch(/ADMIN|UNIT_ADMIN|INSTRUCTOR/);
  });

  test('POST /api/course with an unscoped coreCourseId still 403s for STUDENT', async ({
    request,
  }) => {
    await signUp(request, { email: uniqueEmail('qm-rbac-course-create-unscoped') });

    const res = await request.post(`${QM_BACKEND_URL}/api/course`, {
      data: { coreCourseId: 'nonexistent-or-unauthorized-course-id' },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    // Role gate fires before scoped-list / teaching checks (#1114).
    expect(String(body.error)).toMatch(/ADMIN|UNIT_ADMIN|INSTRUCTOR/);
  });

  test('GET /api/course/:id for own course returns 200 for INSTRUCTOR', async ({
    request,
    playwright,
  }) => {
    await createInstructor(request, { prefix: 'qm-rbac-course-own' });

    const { qmCourseId } = await createQmCourseForInstructor(playwright, request, {
      name: 'Own Course',
      code: 'OWN 101',
    });

    const res = await request.get(`${QM_BACKEND_URL}/api/course/${qmCourseId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data?.name ?? body.name).toBe('Own Course');
  });

  test('GET /api/course/:id returns 403 for STUDENT on an instructor-owned course', async ({
    request,
    playwright,
  }) => {
    // Instructor materializes the anchor; a separate STUDENT session cannot
    // reach it (no teaching enrollment — #1114 fail-closed).
    const instructorCtx = await playwright.request.newContext();
    try {
      await createInstructor(instructorCtx, { prefix: 'qm-rbac-course-own-inst' });
      const { qmCourseId } = await createQmCourseForInstructor(playwright, instructorCtx, {
        name: 'Instructor Course',
        code: 'OWN 102',
      });

      await signUp(request, { email: uniqueEmail('qm-rbac-course-own-student') });
      const res = await request.get(`${QM_BACKEND_URL}/api/course/${qmCourseId}`);
      expect(res.status()).toBe(403);
    } finally {
      await instructorCtx.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Per-course access resolution — GET /api/course/:id/access
//
// This endpoint backs the client course-access gate. Its absence previously made
// the UI fall back to "no access" and wrongly show the "You do not have access to
// this course" banner (notably to ADMINs, who should reach every course).
// ---------------------------------------------------------------------------

test.describe('QM per-course access endpoint', () => {
  test('returns an access level for the caller\'s own course', async ({ request, playwright }) => {
    await createInstructor(request, { prefix: 'qm-access-own' });

    const { qmCourseId } = await createQmCourseForInstructor(playwright, request, {
      name: 'Access Course',
      code: 'ACC 101',
    });

    const res = await request.get(`${QM_BACKEND_URL}/api/course/${qmCourseId}/access`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // #1072: the creator's Core enrollment role (INSTRUCTOR, from
    // `instructorUserIds` on the Core course) resolves the access level now
    // — QM ownership alone no longer implies instructor-level access.
    expect(body.data).toMatchObject({ level: 'instructor', rank: 2 });
  });

  test('returns null access (200, not 403) for a course the caller cannot access', async ({
    playwright,
  }) => {
    const owner = await playwright.request.newContext();
    const other = await playwright.request.newContext();
    try {
      await createInstructor(owner, { prefix: 'qm-access-owner' });
      await signUp(other, { email: uniqueEmail('qm-access-other') });

      const { qmCourseId } = await createQmCourseForInstructor(playwright, owner, {
        name: 'Private Course',
        code: 'ACC 102',
      });

      const res = await other.get(`${QM_BACKEND_URL}/api/course/${qmCourseId}/access`);
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.data).toBeNull();
    } finally {
      await owner.dispose();
      await other.dispose();
    }
  });

  test('returns 404 for a non-existent course', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('qm-access-missing') });
    const res = await request.get(`${QM_BACKEND_URL}/api/course/99999/access`);
    expect(res.status()).toBe(404);
  });

  test('returns 401 without a session', async ({ request }) => {
    const res = await request.fetch(`${QM_BACKEND_URL}/api/course/1/access`, { method: 'GET' });
    expect(res.status()).toBe(401);
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
      await createInstructor(req1, { prefix: 'qm-iso-owner' });
      await signUp(req2, { email: uniqueEmail('qm-iso-other') });

      // User 1 creates a Core-linked QM course
      const { qmCourseId } = await createQmCourseForInstructor(playwright, req1, {
        name: 'Owner Course',
        code: 'ISO 101',
      });

      // User 2 (unrelated STUDENT, no enrollment in User 1's Core course)
      // tries to access User 1's course by ID
      const res = await req2.get(`${QM_BACKEND_URL}/api/course/${qmCourseId}`);
      // Access check must deny access: 403 or 404
      expect([403, 404]).toContain(res.status());
    } finally {
      await req1.dispose();
      await req2.dispose();
    }
  });
});
