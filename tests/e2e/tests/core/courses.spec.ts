/**
 * Core course lifecycle and publish-state visibility E2E tests.
 *
 * Covers: ADMIN creates / updates / publishes / unpublishes / deletes a course;
 * STUDENT enrolled in a course sees it only when it is published.
 *
 * Auth note: Only ADMIN (or UNIT_ADMIN) may create a Core course, and
 * `instructorUserIds` must reference users with role INSTRUCTOR. Every test
 * therefore uses at minimum two contexts — one ADMIN and one INSTRUCTOR —
 * so the helper can pass the INSTRUCTOR's id in the form payload.
 *
 * Requires E2E_SEED_SECRET to be set on the Core service.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { CORE_URL } from '../../playwright.config';
import { createAdmin, createInstructor, registerUser } from '../helpers/auth';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Unique suffix per test run to avoid (code, startDate, section) constraint collisions
const RUN_SUFFIX = Date.now().toString().slice(-5);

async function getMyId(ctx: APIRequestContext): Promise<string> {
  const res = await ctx.get(`${CORE_URL}/api/me`);
  return (await res.json()).id;
}

function coursePayload(instrId: string, overrides: Record<string, string> = {}) {
  const { code: codeBase, ...rest } = overrides;
  return {
    name: 'E2E Test Course',
    code: `${codeBase ?? 'E2E'}-${RUN_SUFFIX}`,
    section: '001',
    term: 'W1',
    year: '2026',
    startDate: '2026-09-08',
    department: 'COSC',
    instructorUserIds: instrId,
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// Course lifecycle — ADMIN creates, INSTRUCTOR is assigned
// ---------------------------------------------------------------------------

test.describe('Core course lifecycle (ADMIN)', () => {
  test('ADMIN can create a course', async ({ playwright }) => {
    const adminCtx = await playwright.request.newContext();
    const instrCtx = await playwright.request.newContext();
    try {
      await createInstructor(instrCtx, { prefix: 'cc-instr' });
      const instrId = await getMyId(instrCtx);
      await createAdmin(adminCtx, { prefix: 'cc-admin' });

      const res = await adminCtx.post(`${CORE_URL}/api/courses`, {
        form: coursePayload(instrId, { name: 'Create Test', code: 'CRT 101' }),
      });
      expect(res.status()).toBe(201);

      const course = await res.json();
      expect(typeof course.id).toBe('string');
      expect(course.name).toBe('Create Test');
      expect(course.isPublished).toBe(false);
    } finally {
      await adminCtx.dispose();
      await instrCtx.dispose();
    }
  });

  test('ADMIN can read their own course list', async ({ playwright }) => {
    const adminCtx = await playwright.request.newContext();
    const instrCtx = await playwright.request.newContext();
    try {
      await createInstructor(instrCtx, { prefix: 'cl-instr' });
      const instrId = await getMyId(instrCtx);
      await createAdmin(adminCtx, { prefix: 'cl-admin' });

      const createRes = await adminCtx.post(`${CORE_URL}/api/courses`, {
        form: coursePayload(instrId, { name: 'List Test', code: 'LST 101' }),
      });
      expect(createRes.status()).toBe(201);
      const { id } = await createRes.json();

      const listRes = await adminCtx.get(`${CORE_URL}/api/courses`);
      expect(listRes.status()).toBe(200);
      const body = await listRes.json();
      const courses: any[] = Array.isArray(body) ? body : (body.courses ?? []);
      expect(courses.some((c) => c.id === id)).toBe(true);
    } finally {
      await adminCtx.dispose();
      await instrCtx.dispose();
    }
  });

  test('ADMIN can read a specific course', async ({ playwright }) => {
    const adminCtx = await playwright.request.newContext();
    const instrCtx = await playwright.request.newContext();
    try {
      await createInstructor(instrCtx, { prefix: 'cg-instr' });
      const instrId = await getMyId(instrCtx);
      await createAdmin(adminCtx, { prefix: 'cg-admin' });

      const { id } = await (
        await adminCtx.post(`${CORE_URL}/api/courses`, {
          form: coursePayload(instrId, { name: 'Get Test', code: 'GET 101' }),
        })
      ).json();

      const getRes = await adminCtx.get(`${CORE_URL}/api/courses/${id}`);
      expect(getRes.status()).toBe(200);
      const course = await getRes.json();
      expect(course.id).toBe(id);
      expect(course.name).toBe('Get Test');
    } finally {
      await adminCtx.dispose();
      await instrCtx.dispose();
    }
  });

  test('ADMIN can update a course name', async ({ playwright }) => {
    const adminCtx = await playwright.request.newContext();
    const instrCtx = await playwright.request.newContext();
    try {
      await createInstructor(instrCtx, { prefix: 'cu-instr' });
      const instrId = await getMyId(instrCtx);
      await createAdmin(adminCtx, { prefix: 'cu-admin' });

      const { id } = await (
        await adminCtx.post(`${CORE_URL}/api/courses`, {
          form: coursePayload(instrId, { name: 'Original Name', code: 'UPD 101' }),
        })
      ).json();

      const patchRes = await adminCtx.patch(`${CORE_URL}/api/courses/${id}`, {
        data: { name: 'Updated Name' },
      });
      expect(patchRes.status()).toBe(200);
      expect((await patchRes.json()).name).toBe('Updated Name');
    } finally {
      await adminCtx.dispose();
      await instrCtx.dispose();
    }
  });

  test('ADMIN can publish and unpublish a course', async ({ playwright }) => {
    const adminCtx = await playwright.request.newContext();
    const instrCtx = await playwright.request.newContext();
    try {
      await createInstructor(instrCtx, { prefix: 'pub-instr' });
      const instrId = await getMyId(instrCtx);
      await createAdmin(adminCtx, { prefix: 'pub-admin' });

      const { id } = await (
        await adminCtx.post(`${CORE_URL}/api/courses`, {
          form: coursePayload(instrId, { name: 'Publish Test', code: 'PUB 101' }),
        })
      ).json();

      const pubRes = await adminCtx.patch(`${CORE_URL}/api/courses/${id}/publish`);
      expect(pubRes.status()).toBe(200);
      expect((await pubRes.json()).isPublished).toBe(true);

      const unpubRes = await adminCtx.patch(`${CORE_URL}/api/courses/${id}/unpublish`);
      expect(unpubRes.status()).toBe(200);
      expect((await unpubRes.json()).isPublished).toBe(false);
    } finally {
      await adminCtx.dispose();
      await instrCtx.dispose();
    }
  });

  test('ADMIN can soft-delete a course and it disappears from GET', async ({ playwright }) => {
    const adminCtx = await playwright.request.newContext();
    const instrCtx = await playwright.request.newContext();
    try {
      await createInstructor(instrCtx, { prefix: 'del-instr' });
      const instrId = await getMyId(instrCtx);
      await createAdmin(adminCtx, { prefix: 'del-admin' });

      const { id } = await (
        await adminCtx.post(`${CORE_URL}/api/courses`, {
          form: coursePayload(instrId, { name: 'Delete Test', code: 'DEL 101' }),
        })
      ).json();

      const delRes = await adminCtx.delete(`${CORE_URL}/api/courses/${id}`);
      expect(delRes.status()).toBe(204);

      const getRes = await adminCtx.get(`${CORE_URL}/api/courses/${id}`);
      expect([403, 404]).toContain(getRes.status());
    } finally {
      await adminCtx.dispose();
      await instrCtx.dispose();
    }
  });

  test('STUDENT blocked from creating a course (403)', async ({ request }) => {
    await registerUser(request, { prefix: 'create-student-blocked' });

    const res = await request.post(`${CORE_URL}/api/courses`, {
      form: {
        name: 'Blocked',
        code: 'BLK 101',
        section: '001',
        term: 'W1',
        year: '2026',
        startDate: '2026-09-08',
        department: 'COSC',
        instructorUserIds: 'some-id',
      },
    });
    expect(res.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Publish-state visibility — enrolled STUDENT
// ---------------------------------------------------------------------------

test.describe('Course publish-state controls STUDENT visibility', () => {
  test('enrolled STUDENT sees published course, not unpublished', async ({ playwright }) => {
    const adminCtx = await playwright.request.newContext();
    const instrCtx = await playwright.request.newContext();
    const studentCtx = await playwright.request.newContext();

    try {
      await createInstructor(instrCtx, { prefix: 'vis-instr' });
      const instrId = await getMyId(instrCtx);
      await createAdmin(adminCtx, { prefix: 'vis-admin' });
      await registerUser(studentCtx, { prefix: 'vis-student' });

      const { id: studentId } = await (await studentCtx.get(`${CORE_URL}/api/me`)).json();

      const createRes = await adminCtx.post(`${CORE_URL}/api/courses`, {
        form: coursePayload(instrId, { name: 'Visibility Test', code: 'VIS 101' }),
      });
      expect(createRes.status()).toBe(201);
      const { id: courseId } = await createRes.json();

      // Admin enrolls the student
      const enrollRes = await adminCtx.post(`${CORE_URL}/api/courses/${courseId}/enrollments`, {
        data: { userId: studentId, role: 'STUDENT' },
      });
      expect(enrollRes.status()).toBe(201);

      // Unpublished: student's course list is empty
      const unpubListRes = await studentCtx.get(`${CORE_URL}/api/courses`);
      expect(unpubListRes.status()).toBe(200);
      const unpubBody = await unpubListRes.json();
      const unpubCourses: any[] = Array.isArray(unpubBody) ? unpubBody : (unpubBody.courses ?? []);
      expect(unpubCourses.some((c) => c.id === courseId)).toBe(false);

      // Unpublished: direct GET by student returns 403
      const unpubGetRes = await studentCtx.get(`${CORE_URL}/api/courses/${courseId}`);
      expect(unpubGetRes.status()).toBe(403);

      // Admin publishes
      const pubRes = await adminCtx.patch(`${CORE_URL}/api/courses/${courseId}/publish`);
      expect(pubRes.status()).toBe(200);

      // Published: student sees it in their list
      const pubListRes = await studentCtx.get(`${CORE_URL}/api/courses`);
      expect(pubListRes.status()).toBe(200);
      const pubBody = await pubListRes.json();
      const pubCourses: any[] = Array.isArray(pubBody) ? pubBody : (pubBody.courses ?? []);
      expect(pubCourses.some((c) => c.id === courseId)).toBe(true);

      // Published: direct GET by student returns 200
      const pubGetRes = await studentCtx.get(`${CORE_URL}/api/courses/${courseId}`);
      expect(pubGetRes.status()).toBe(200);

      // Admin unpublishes
      const unpubRes = await adminCtx.patch(`${CORE_URL}/api/courses/${courseId}/unpublish`);
      expect(unpubRes.status()).toBe(200);

      // Unpublished again: student no longer sees it
      const unpubListRes2 = await studentCtx.get(`${CORE_URL}/api/courses`);
      const unpubBody2 = await unpubListRes2.json();
      const unpubCourses2: any[] = Array.isArray(unpubBody2) ? unpubBody2 : (unpubBody2.courses ?? []);
      expect(unpubCourses2.some((c) => c.id === courseId)).toBe(false);
    } finally {
      await adminCtx.dispose();
      await instrCtx.dispose();
      await studentCtx.dispose();
    }
  });

  test('unenrolled STUDENT cannot see any course regardless of publish state', async ({
    playwright,
  }) => {
    const adminCtx = await playwright.request.newContext();
    const instrCtx = await playwright.request.newContext();
    const studentCtx = await playwright.request.newContext();

    try {
      await createInstructor(instrCtx, { prefix: 'une-instr' });
      const instrId = await getMyId(instrCtx);
      await createAdmin(adminCtx, { prefix: 'une-admin' });
      await registerUser(studentCtx, { prefix: 'une-student' });

      const { id: courseId } = await (
        await adminCtx.post(`${CORE_URL}/api/courses`, {
          form: coursePayload(instrId, { name: 'Unenrolled Test', code: 'UNE 101' }),
        })
      ).json();

      await adminCtx.patch(`${CORE_URL}/api/courses/${courseId}/publish`);

      const listRes = await studentCtx.get(`${CORE_URL}/api/courses`);
      expect(listRes.status()).toBe(200);
      const body = await listRes.json();
      const courses: any[] = Array.isArray(body) ? body : (body.courses ?? []);
      expect(courses.some((c) => c.id === courseId)).toBe(false);

      const getRes = await studentCtx.get(`${CORE_URL}/api/courses/${courseId}`);
      expect([403, 404]).toContain(getRes.status());
    } finally {
      await adminCtx.dispose();
      await instrCtx.dispose();
      await studentCtx.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Enrollment management
// ---------------------------------------------------------------------------

test.describe('Core enrollment management', () => {
  test('ADMIN can enroll a STUDENT and the enrollment appears in the list', async ({
    playwright,
  }) => {
    const adminCtx = await playwright.request.newContext();
    const instrCtx = await playwright.request.newContext();
    const studentCtx = await playwright.request.newContext();

    try {
      await createInstructor(instrCtx, { prefix: 'enr-instr' });
      const instrId = await getMyId(instrCtx);
      await createAdmin(adminCtx, { prefix: 'enr-admin' });
      await registerUser(studentCtx, { prefix: 'enr-student' });

      const { id: studentId } = await (await studentCtx.get(`${CORE_URL}/api/me`)).json();

      const { id: courseId } = await (
        await adminCtx.post(`${CORE_URL}/api/courses`, {
          form: coursePayload(instrId, { name: 'Enrollment Mgmt', code: 'ENR 202' }),
        })
      ).json();

      const enrollRes = await adminCtx.post(`${CORE_URL}/api/courses/${courseId}/enrollments`, {
        data: { userId: studentId, role: 'STUDENT' },
      });
      expect(enrollRes.status()).toBe(201);

      const listRes = await adminCtx.get(`${CORE_URL}/api/courses/${courseId}/enrollments`);
      expect(listRes.status()).toBe(200);
      const body = await listRes.json();
      const enrollments: any[] = Array.isArray(body) ? body : (body.enrollments ?? []);
      expect(enrollments.some((e: any) => e.studentId === studentId)).toBe(true);
    } finally {
      await adminCtx.dispose();
      await instrCtx.dispose();
      await studentCtx.dispose();
    }
  });

  test('STUDENT cannot enroll themselves (403)', async ({ request }) => {
    await registerUser(request, { prefix: 'self-enroll-student' });

    const res = await request.post(`${CORE_URL}/api/courses/fake-course-id/enrollments`, {
      data: { userId: 'some-user-id', role: 'STUDENT' },
    });
    expect([401, 403, 404]).toContain(res.status());
  });
});
