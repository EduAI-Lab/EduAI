/**
 * AI Tutor /dashboard + submissions smoke E2E tests.
 *
 * Backs two surfaces added in the Week 10 redesign (#938):
 *   - the role-aware `/dashboard` landing → `GET /api/me/dashboard-stats`
 *   - the instructor Submissions tab → `GET /api/courses/:id/submissions`
 *
 * API-level smoke: confirms each endpoint is reachable, role-shaped, and gated.
 * Auth is a forwarded Core session (see access.spec.ts) — Playwright includes
 * the session cookie automatically on every localhost:* origin.
 */
import { test, expect } from '@playwright/test';
import { AI_TUTOR_API_URL } from '../../playwright.config';
import { signUp, uniqueEmail, createInstructor } from '../helpers/auth';
import { importAtCourseForInstructor } from '../helpers/at-courses';

const AT = AI_TUTOR_API_URL;

// ---------------------------------------------------------------------------
// /dashboard landing — GET /api/me/dashboard-stats
// ---------------------------------------------------------------------------

test.describe('AI Tutor dashboard stats', () => {
  test('GET /api/me/dashboard-stats returns 401 when unauthenticated', async ({ request }) => {
    const res = await request.get(`${AT}/api/me/dashboard-stats`);
    expect(res.status()).toBe(401);
  });

  test('STUDENT gets a student-shaped rollup', async ({ request }) => {
    await signUp(request, { email: uniqueEmail('at-dash-student') });

    const res = await request.get(`${AT}/api/me/dashboard-stats`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('STUDENT');
    expect(typeof body.enrolledCourses).toBe('number');
    expect(body).toHaveProperty('correctAnswerPercentage');
  });

  test('INSTRUCTOR gets an instructor-shaped rollup', async ({ request }) => {
    await createInstructor(request, { prefix: 'at-dash-instr' });

    const res = await request.get(`${AT}/api/me/dashboard-stats`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('INSTRUCTOR');
    expect(typeof body.yourCourses).toBe('number');
    expect(body).toHaveProperty('submissionsToReview');
  });
});

// ---------------------------------------------------------------------------
// Submissions tab — GET /api/courses/:id/submissions
// ---------------------------------------------------------------------------

test.describe('AI Tutor course submissions', () => {
  test('GET /api/courses/:id/submissions returns 401 when unauthenticated', async ({ request }) => {
    const res = await request.get(`${AT}/api/courses/1/submissions`);
    expect(res.status()).toBe(401);
  });

  test('INSTRUCTOR reads an (empty) enriched submissions list for their course', async ({
    request,
    playwright,
  }) => {
    await createInstructor(request, { prefix: 'at-subs-instr' });
    const { atCourseId } = await importAtCourseForInstructor(playwright, request, {
      name: 'Submissions Host',
    });

    const res = await request.get(`${AT}/api/courses/${atCourseId}/submissions`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('STUDENT not on the course is forbidden from its submissions list', async ({
    request,
    playwright,
  }) => {
    // Instructor sets up a real course...
    await createInstructor(request, { prefix: 'at-subs-owner' });
    const { atCourseId } = await importAtCourseForInstructor(playwright, request, {
      name: 'Gated Submissions',
    });

    // ...then a fresh (unenrolled) STUDENT taking over the context is blocked.
    await signUp(request, { email: uniqueEmail('at-subs-student') });
    const res = await request.get(`${AT}/api/courses/${atCourseId}/submissions`);
    expect(res.status()).toBe(403);
  });
});
