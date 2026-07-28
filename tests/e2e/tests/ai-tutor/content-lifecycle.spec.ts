/**
 * AI Tutor INSTRUCTOR content authoring and publish-state visibility E2E tests.
 *
 * Covers: Core-imported courses; INSTRUCTOR creates modules / lessons; the publish hierarchy
 * (course must be published before a module, module before a lesson); STUDENT
 * visibility gates at every level; cascade unpublish; AI Tutor admin endpoints.
 *
 * Auth: AI Tutor validates every request by forwarding the caller's cookie to
 * Core's POST /api/sessions/validate. Playwright automatically includes the
 * session cookie on all localhost:* origins, so a Core session created by
 * createInstructor / createAdmin / registerUser is immediately valid in AT.
 */
import { test, expect } from '@playwright/test';
import { AI_TUTOR_API_URL, CORE_URL } from '../../playwright.config';
import { createAdmin, createInstructor, registerUser } from '../helpers/auth';
import { importAtCourseForInstructor } from '../helpers/at-courses';

const AT = AI_TUTOR_API_URL;

// ---------------------------------------------------------------------------
// INSTRUCTOR content authoring — create course / module / lesson
// ---------------------------------------------------------------------------

test.describe('AI Tutor INSTRUCTOR content authoring', () => {
  test('POST /api/courses returns 403 — course creation is managed in EduAI Core', async ({
    request,
  }) => {
    await createInstructor(request, { prefix: 'at-create-course' });

    const res = await request.post(`${AT}/api/courses`, {
      data: { title: 'E2E Lifecycle Course' },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toMatch(/EduAI Core/i);
  });

  test('INSTRUCTOR can create a module in their course', async ({ request, playwright }) => {
    await createInstructor(request, { prefix: 'at-create-module' });

    const { atCourseId: courseId } = await importAtCourseForInstructor(playwright, request, {
      name: 'Module Host Course',
    });

    const modRes = await request.post(`${AT}/api/courses/${courseId}/modules`, {
      data: { title: 'Week 1: Introduction' },
    });
    expect(modRes.status()).toBe(201);

    const module = await modRes.json();
    expect(typeof module.id).toBe('number');
    expect(module.title).toBe('Week 1: Introduction');
    expect(module.isPublished).toBe(false);
  });

  test('INSTRUCTOR can create a lesson in their module', async ({ request, playwright }) => {
    await createInstructor(request, { prefix: 'at-create-lesson' });

    const { atCourseId: courseId } = await importAtCourseForInstructor(playwright, request, {
      name: 'Lesson Host Course',
    });
    const { id: moduleId } = await (
      await request.post(`${AT}/api/courses/${courseId}/modules`, { data: { title: 'Module for Lesson' } })
    ).json();

    const lessonRes = await request.post(`${AT}/api/modules/${moduleId}/lessons`, {
      data: { title: 'Lesson 1' },
    });
    expect(lessonRes.status()).toBe(201);

    const lesson = await lessonRes.json();
    expect(typeof lesson.id).toBe('number');
    expect(lesson.title).toBe('Lesson 1');
    expect(lesson.isPublished).toBe(false);
  });

  test('INSTRUCTOR sees their unpublished course in GET /api/courses', async ({
    request,
    playwright,
  }) => {
    await createInstructor(request, { prefix: 'at-list-course' });

    const { atCourseId: courseId } = await importAtCourseForInstructor(playwright, request, {
      name: 'Unlisted Draft Course',
    });

    const listRes = await request.get(`${AT}/api/courses`);
    expect(listRes.status()).toBe(200);
    const courses = await listRes.json();
    expect(Array.isArray(courses)).toBe(true);
    expect(courses.some((c: any) => c.id === courseId)).toBe(true);
  });

  test('STUDENT cannot create a course (403)', async ({ request }) => {
    await registerUser(request, { prefix: 'at-no-create' });

    const res = await request.post(`${AT}/api/courses`, {
      data: { title: 'Blocked Course' },
    });
    expect(res.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Publish pre-conditions
// ---------------------------------------------------------------------------

test.describe('AI Tutor publish hierarchy pre-conditions', () => {
  test('publishing a module when its parent course is unpublished returns 400', async ({
    request,
    playwright,
  }) => {
    await createInstructor(request, { prefix: 'at-mod-pre' });

    const { atCourseId: courseId } = await importAtCourseForInstructor(playwright, request, {
      name: 'Pre-publish Course',
    });
    const { id: moduleId } = await (
      await request.post(`${AT}/api/courses/${courseId}/modules`, { data: { title: 'Orphan Module' } })
    ).json();

    const res = await request.patch(`${AT}/api/modules/${moduleId}/publish`);
    expect(res.status()).toBe(400);
  });

  test('publishing a lesson when its parent module is unpublished returns 400', async ({
    request,
    playwright,
  }) => {
    await createInstructor(request, { prefix: 'at-lesson-pre' });

    const { atCourseId: courseId } = await importAtCourseForInstructor(playwright, request, {
      name: 'Pre-lesson Course',
    });
    const { id: moduleId } = await (
      await request.post(`${AT}/api/courses/${courseId}/modules`, { data: { title: 'Pre-lesson Module' } })
    ).json();
    const { id: lessonId } = await (
      await request.post(`${AT}/api/modules/${moduleId}/lessons`, { data: { title: 'Pre-lesson Lesson' } })
    ).json();

    // Publish course but intentionally leave module unpublished
    await request.patch(`${AT}/api/courses/${courseId}/publish`);

    const res = await request.patch(`${AT}/api/lessons/${lessonId}/publish`);
    expect(res.status()).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Publish-state controls STUDENT visibility
// ---------------------------------------------------------------------------

test.describe('AI Tutor publish-state controls STUDENT visibility', () => {
  test('enrolled STUDENT cannot see an unpublished course', async ({ playwright }) => {
    const instrCtx = await playwright.request.newContext();
    const studentCtx = await playwright.request.newContext();

    try {
      await createInstructor(instrCtx, { prefix: 'at-vis-instr' });
      await registerUser(studentCtx, { prefix: 'at-vis-student' });

      const { id: studentId } = await (await studentCtx.get(`${CORE_URL}/api/me`)).json();

      const { atCourseId: courseId } = await importAtCourseForInstructor(playwright, instrCtx, {
        name: 'Unpublished Course',
      });

      await instrCtx.post(`${AT}/api/admin/courses/${courseId}/enrollments`, {
        data: { userId: studentId, role: 'STUDENT' },
      });

      const listRes = await studentCtx.get(`${AT}/api/courses`);
      expect(listRes.status()).toBe(200);
      const courses = await listRes.json();
      expect(courses.some((c: any) => c.id === courseId)).toBe(false);
    } finally {
      await instrCtx.dispose();
      await studentCtx.dispose();
    }
  });

  test('enrolled STUDENT sees the course after INSTRUCTOR publishes it', async ({ playwright }) => {
    const instrCtx = await playwright.request.newContext();
    const studentCtx = await playwright.request.newContext();

    try {
      await createInstructor(instrCtx, { prefix: 'at-pub-instr' });
      await registerUser(studentCtx, { prefix: 'at-pub-student' });

      const { id: studentId } = await (await studentCtx.get(`${CORE_URL}/api/me`)).json();

      const { atCourseId: courseId } = await importAtCourseForInstructor(playwright, instrCtx, {
        name: 'To-be-Published Course',
      });

      await instrCtx.post(`${AT}/api/admin/courses/${courseId}/enrollments`, {
        data: { userId: studentId, role: 'STUDENT' },
      });

      const pubRes = await instrCtx.patch(`${AT}/api/courses/${courseId}/publish`);
      expect(pubRes.status()).toBe(200);
      expect((await pubRes.json()).isPublished).toBe(true);

      const listRes = await studentCtx.get(`${AT}/api/courses`);
      expect(listRes.status()).toBe(200);
      const courses = await listRes.json();
      expect(courses.some((c: any) => c.id === courseId)).toBe(true);
    } finally {
      await instrCtx.dispose();
      await studentCtx.dispose();
    }
  });

  test('INSTRUCTOR publishes course → module → lesson; enrolled STUDENT sees all three', async ({
    playwright,
  }) => {
    const instrCtx = await playwright.request.newContext();
    const studentCtx = await playwright.request.newContext();

    try {
      await createInstructor(instrCtx, { prefix: 'at-full-instr' });
      await registerUser(studentCtx, { prefix: 'at-full-student' });

      const { id: studentId } = await (await studentCtx.get(`${CORE_URL}/api/me`)).json();

      const { atCourseId: courseId } = await importAtCourseForInstructor(playwright, instrCtx, {
        name: 'Full Hierarchy Course',
      });
      const { id: moduleId } = await (
        await instrCtx.post(`${AT}/api/courses/${courseId}/modules`, { data: { title: 'Module 1' } })
      ).json();
      const { id: lessonId } = await (
        await instrCtx.post(`${AT}/api/modules/${moduleId}/lessons`, { data: { title: 'Lesson 1' } })
      ).json();

      await instrCtx.post(`${AT}/api/admin/courses/${courseId}/enrollments`, {
        data: { userId: studentId, role: 'STUDENT' },
      });

      // Must publish in order: course first, then module, then lesson
      await instrCtx.patch(`${AT}/api/courses/${courseId}/publish`);
      await instrCtx.patch(`${AT}/api/modules/${moduleId}/publish`);
      await instrCtx.patch(`${AT}/api/lessons/${lessonId}/publish`);

      const coursesRes = await studentCtx.get(`${AT}/api/courses`);
      const courses = await coursesRes.json();
      expect(courses.some((c: any) => c.id === courseId)).toBe(true);

      const modulesRes = await studentCtx.get(`${AT}/api/courses/${courseId}/modules`);
      expect(modulesRes.status()).toBe(200);
      const modules = await modulesRes.json();
      expect(modules.some((m: any) => m.id === moduleId)).toBe(true);

      const lessonsRes = await studentCtx.get(`${AT}/api/modules/${moduleId}/lessons`);
      expect(lessonsRes.status()).toBe(200);
      const lessons = await lessonsRes.json();
      expect(lessons.some((l: any) => l.id === lessonId)).toBe(true);
    } finally {
      await instrCtx.dispose();
      await studentCtx.dispose();
    }
  });

  test('INSTRUCTOR sees unpublished modules but STUDENT does not', async ({ playwright }) => {
    const instrCtx = await playwright.request.newContext();
    const studentCtx = await playwright.request.newContext();

    try {
      await createInstructor(instrCtx, { prefix: 'at-mod-vis-instr' });
      await registerUser(studentCtx, { prefix: 'at-mod-vis-student' });

      const { id: studentId } = await (await studentCtx.get(`${CORE_URL}/api/me`)).json();

      const { atCourseId: courseId } = await importAtCourseForInstructor(playwright, instrCtx, {
        name: 'Module Visibility Course',
      });
      const { id: moduleId } = await (
        await instrCtx.post(`${AT}/api/courses/${courseId}/modules`, { data: { title: 'Draft Module' } })
      ).json();

      await instrCtx.post(`${AT}/api/admin/courses/${courseId}/enrollments`, {
        data: { userId: studentId, role: 'STUDENT' },
      });

      // Publish course but leave module unpublished
      await instrCtx.patch(`${AT}/api/courses/${courseId}/publish`);

      // INSTRUCTOR sees unpublished module
      const instrModules = await instrCtx.get(`${AT}/api/courses/${courseId}/modules`);
      expect((await instrModules.json()).some((m: any) => m.id === moduleId)).toBe(true);

      // STUDENT sees no modules (module is unpublished)
      const studentModules = await studentCtx.get(`${AT}/api/courses/${courseId}/modules`);
      expect(studentModules.status()).toBe(200);
      const mods = await studentModules.json();
      expect(mods.some((m: any) => m.id === moduleId)).toBe(false);
    } finally {
      await instrCtx.dispose();
      await studentCtx.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Cascade unpublish
// ---------------------------------------------------------------------------

test.describe('AI Tutor cascade unpublish', () => {
  test('unpublishing a course cascades to all modules and lessons', async ({ request, playwright }) => {
    await createInstructor(request, { prefix: 'at-cascade-instr' });

    const { atCourseId: courseId } = await importAtCourseForInstructor(playwright, request, {
      name: 'Cascade Unpublish Course',
    });
    const { id: moduleId } = await (
      await request.post(`${AT}/api/courses/${courseId}/modules`, { data: { title: 'Cascade Module' } })
    ).json();
    const { id: lessonId } = await (
      await request.post(`${AT}/api/modules/${moduleId}/lessons`, { data: { title: 'Cascade Lesson' } })
    ).json();

    // Publish the full hierarchy
    await request.patch(`${AT}/api/courses/${courseId}/publish`);
    await request.patch(`${AT}/api/modules/${moduleId}/publish`);
    await request.patch(`${AT}/api/lessons/${lessonId}/publish`);

    // Unpublish course — cascades to module and lesson
    const unpubRes = await request.patch(`${AT}/api/courses/${courseId}/unpublish`);
    expect(unpubRes.status()).toBe(200);
    expect((await unpubRes.json()).isPublished).toBe(false);

    const modRes = await request.get(`${AT}/api/modules/${moduleId}`);
    expect((await modRes.json()).isPublished).toBe(false);

    const lessonRes = await request.get(`${AT}/api/lessons/${lessonId}`);
    expect((await lessonRes.json()).isPublished).toBe(false);
  });

  test('unpublishing a module cascades to its lessons', async ({ request, playwright }) => {
    await createInstructor(request, { prefix: 'at-mod-cascade-instr' });

    const { atCourseId: courseId } = await importAtCourseForInstructor(playwright, request, {
      name: 'Module Cascade Course',
    });
    const { id: moduleId } = await (
      await request.post(`${AT}/api/courses/${courseId}/modules`, { data: { title: 'Cascade Module' } })
    ).json();
    const { id: lessonId } = await (
      await request.post(`${AT}/api/modules/${moduleId}/lessons`, { data: { title: 'Cascade Lesson' } })
    ).json();

    await request.patch(`${AT}/api/courses/${courseId}/publish`);
    await request.patch(`${AT}/api/modules/${moduleId}/publish`);
    await request.patch(`${AT}/api/lessons/${lessonId}/publish`);

    const unpubRes = await request.patch(`${AT}/api/modules/${moduleId}/unpublish`);
    expect(unpubRes.status()).toBe(200);
    expect((await unpubRes.json()).isPublished).toBe(false);

    const lessonRes = await request.get(`${AT}/api/lessons/${lessonId}`);
    expect((await lessonRes.json()).isPublished).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AI Tutor admin endpoints
// ---------------------------------------------------------------------------

test.describe('AI Tutor admin endpoints', () => {
  // #1041: this proxies Core's paginated user list, so it answers with the
  // `{ data, total, page, pageSize, stats }` envelope rather than a bare array.
  test('ADMIN GET /api/admin/users returns 200 with a page envelope', async ({ request }) => {
    await createAdmin(request, { prefix: 'at-admin-users' });

    const res = await request.get(`${AT}/api/admin/users?page=1&pageSize=25`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(25);
    expect(typeof body.total).toBe('number');
    expect(typeof body.stats.total).toBe('number');
  });

  test('ADMIN GET /api/admin/courses returns 200 with an array', async ({ request }) => {
    await createAdmin(request, { prefix: 'at-admin-courses' });

    const res = await request.get(`${AT}/api/admin/courses`);
    expect(res.status()).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  test('PATCH /api/admin/users/:userId/role returns 410 (roles are managed by EduAI)', async ({
    request,
  }) => {
    await createAdmin(request, { prefix: 'at-role-410' });

    const res = await request.patch(`${AT}/api/admin/users/some-user-id/role`, {
      data: { role: 'INSTRUCTOR' },
    });
    expect(res.status()).toBe(410);
  });
});
