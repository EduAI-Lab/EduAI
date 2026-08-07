/**
 * Cross-service publish propagation and shared-identity E2E tests.
 *
 * Covers the integration seams between Core and AI Tutor that are not
 * exercised by either service's own spec:
 *
 *   1. Shared user identity — Core user IDs are the enrollment key in AI
 *      Tutor. An INSTRUCTOR enrolling a student by their Core user ID lets
 *      that student (authenticated via Core session cookie) see the AT course.
 *
 *   2. Independent enrollment tracking — enrolling a user in a Core course
 *      does NOT automatically enroll them in a corresponding native AI Tutor
 *      course. The student can see the Core course but not the AT course until
 *      explicitly enrolled there too.
 *
 *   3. Role propagation — an INSTRUCTOR promoted in Core can immediately
 *      create content in AI Tutor without any separate AT login or token
 *      exchange, because AT validates every request against the Core session.
 *
 * Cookie model: Playwright shares the session cookie across all
 * localhost:* origins automatically, so the same request context authenticates
 * against Core (port 3000) and AI Tutor (port 4000) simultaneously.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { AI_TUTOR_API_URL, CORE_URL } from '../../playwright.config';
import { createAdmin, createInstructor, registerUser } from '../helpers/auth';
import { importAtCourseForInstructor } from '../helpers/at-courses';
import { canSeeCoreCourse } from '../helpers/core-courses';
import { atListData, atListResponse } from '../helpers/at-pagination';

async function getMyId(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${CORE_URL}/api/me`);
  return (await res.json()).id;
}

const AT = AI_TUTOR_API_URL;
const RUN_SUFFIX = Date.now().toString().slice(-5);

// ---------------------------------------------------------------------------
// Shared user identity
// ---------------------------------------------------------------------------

test.describe('Cross-service shared user identity (Core userId in AT enrollment)', () => {
  test('student enrolled in AT using their Core userId can see a published AT course', async ({
    playwright,
  }) => {
    const instrCtx = await playwright.request.newContext();
    const studentCtx = await playwright.request.newContext();

    try {
      await createInstructor(instrCtx, { prefix: 'cs-identity-instr' });
      await registerUser(studentCtx, { prefix: 'cs-identity-student' });

      // Get the student's Core user ID — this is the same ID used in AT enrollments
      const { id: coreStudentId } = await (await studentCtx.get(`${CORE_URL}/api/me`)).json();

      // INSTRUCTOR imports a Core-linked AT course
      const { atCourseId: courseId } = await importAtCourseForInstructor(playwright, instrCtx, {
        name: 'Identity Test Course',
      });

      // Enroll the student using their Core user ID
      const enrollRes = await instrCtx.post(`${AT}/api/admin/courses/${courseId}/enrollments`, {
        data: { userId: coreStudentId, role: 'STUDENT' },
      });
      expect(enrollRes.status()).toBe(201);

      // Publish the course
      await instrCtx.patch(`${AT}/api/courses/${courseId}/publish`);

      // The student's Core session is sufficient to see the AT course
      const courses = await atListData<{ id: number }>(studentCtx, `${AT}/api/courses`);
      expect(courses.some((c) => c.id === courseId)).toBe(true);
    } finally {
      await instrCtx.dispose();
      await studentCtx.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Independent enrollment tracking
// ---------------------------------------------------------------------------

test.describe('Core and AI Tutor enrollment tracks are independent', () => {
  test('student enrolled in a Core course is NOT automatically enrolled in a native AT course', async ({
    playwright,
  }) => {
    const adminCtx = await playwright.request.newContext();
    const instrCtx = await playwright.request.newContext();
    const studentCtx = await playwright.request.newContext();

    try {
      await createAdmin(adminCtx, { prefix: 'cs-indep-admin' });
      await createInstructor(instrCtx, { prefix: 'cs-indep-instr' });
      await registerUser(studentCtx, { prefix: 'cs-indep-student' });

      const { id: studentId } = await (await studentCtx.get(`${CORE_URL}/api/me`)).json();
      const instrId = await getMyId(instrCtx);

      // Create and publish a Core course; enroll the student there
      const coreCreateRes = await adminCtx.post(`${CORE_URL}/api/courses`, {
        form: {
          name: 'CS Indep Course',
          code: `CS-399-${RUN_SUFFIX}`,
          section: '001',
          term: 'W1',
          year: '2026',
          startDate: '2026-09-08',
          department: 'COSC',
          instructorUserIds: instrId,
        },
      });
      expect(coreCreateRes.status()).toBe(201);
      const { id: coreCourseId } = await coreCreateRes.json();

      await adminCtx.post(`${CORE_URL}/api/courses/${coreCourseId}/enrollments`, {
        data: { userId: studentId, role: 'STUDENT' },
      });
      await adminCtx.patch(`${CORE_URL}/api/courses/${coreCourseId}/publish`);

      // Student sees the Core course
      expect(await canSeeCoreCourse(studentCtx, coreCourseId)).toBe(true);

      // INSTRUCTOR imports a separate Core-linked AT course (not the Core-enrolled course)
      const { atCourseId } = await importAtCourseForInstructor(playwright, instrCtx, {
        name: 'Native AT Course',
        code: 'AT-INDEP',
      });
      await instrCtx.patch(`${AT}/api/courses/${atCourseId}/publish`);

      // Student is NOT enrolled in the AT course — it should not appear in their AT list
      const atCourses = await atListData<{ id: number }>(studentCtx, `${AT}/api/courses`);
      expect(atCourses.some((c) => c.id === atCourseId)).toBe(false);
    } finally {
      await adminCtx.dispose();
      await instrCtx.dispose();
      await studentCtx.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Role propagation
// ---------------------------------------------------------------------------

test.describe('Core role changes propagate to AI Tutor immediately', () => {
  test('INSTRUCTOR promoted in Core can create AT content without a separate AT login', async ({
    request,
    playwright,
  }) => {
    // createInstructor promotes via Core's /api/e2e/promote then re-signs in;
    // the resulting session is verified immediately in AT with no extra steps.
    await createInstructor(request, { prefix: 'cs-role-instr' });

    const { atCourseId } = await importAtCourseForInstructor(playwright, request, {
      name: 'Role Propagation Course',
    });

    const res = await request.post(`${AT}/api/courses/${atCourseId}/modules`, {
      data: { title: 'Module after Core import' },
    });
    expect(res.status()).toBe(201);
  });

  test('ADMIN promoted in Core can access AT admin-only routes', async ({ request }) => {
    await createAdmin(request, { prefix: 'cs-role-admin' });

    const usersRes = await request.get(`${AT}/api/admin/users`);
    expect(usersRes.status()).toBe(200);

    const coursesRes = await atListResponse(request, `${AT}/api/admin/courses`);
    expect(coursesRes.status()).toBe(200);
  });

  test('STUDENT in Core is blocked from AT INSTRUCTOR-only routes', async ({ request }) => {
    await registerUser(request, { prefix: 'cs-role-student' });

    const res = await request.post(`${AT}/api/courses`, {
      data: { title: 'Should Be Blocked' },
    });
    expect(res.status()).toBe(403);
  });
});
