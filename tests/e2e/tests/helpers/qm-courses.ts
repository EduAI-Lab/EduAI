import { expect, type APIRequestContext } from '@playwright/test';
import { CORE_URL, QM_BACKEND_URL } from '../../playwright.config';
import { createAdmin, createInstructor } from './auth';

const QM = QM_BACKEND_URL;
const RUN_SUFFIX = Date.now().toString().slice(-5);

type PlaywrightRequestFixture = {
  request: { newContext: () => Promise<APIRequestContext> };
};

/**
 * Triggers QM's auto-import-on-list flow (importTaughtCoursesFromCore): an
 * INSTRUCTOR's `GET /api/course` call mirrors any Core course they teach into
 * a local QM `Course` row linked via `coreCourseId`. Returns the local QM
 * course id for the given Core course, waiting briefly for propagation.
 */
export async function importQmCourseForInstructor(
  instrCtx: APIRequestContext,
  coreCourseId: string,
): Promise<{ qmCourseId: number }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const listRes = await instrCtx.get(`${QM}/api/course`);
    expect(listRes.status()).toBe(200);
    const { data: courses } = await listRes.json();
    const match = (courses as Array<{ id: number; coreCourseId?: string | null }>).find(
      (c) => c.coreCourseId === coreCourseId,
    );
    if (match) return { qmCourseId: match.id };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`QM never imported Core course ${coreCourseId}`);
}

function coreCourseForm(instrId: string, overrides: Record<string, string> = {}) {
  const { code: codeBase, ...rest } = overrides;
  return {
    name: 'E2E QM Course',
    code: `${codeBase ?? 'QM-E2E'}-${RUN_SUFFIX}-${Math.floor(Math.random() * 1e4)}`,
    section: '001',
    term: 'W1',
    year: '2026',
    startDate: '2026-08-15',
    department: 'COSC',
    instructorUserIds: instrId,
    ...rest,
  };
}

/**
 * Create a Core course (admin) assigned to `instrCtx` as instructor, then
 * create the QM anchor for it as the instructor via
 * `POST /api/course {coreCourseId}` (#1072: QM local-only course creation is
 * retired — every QM course row is a caller-scoped anchor to a Core course).
 */
export async function createQmCourseForInstructor(
  playwright: PlaywrightRequestFixture,
  instrCtx: APIRequestContext,
  overrides: Record<string, string> = {},
): Promise<{ coreCourseId: string; qmCourseId: number }> {
  const adminCtx = await playwright.request.newContext();

  try {
    await createAdmin(adminCtx, { prefix: 'qm-course-admin' });
    const { id: instrId } = await (await instrCtx.get(`${CORE_URL}/api/me`)).json();

    const coreRes = await adminCtx.post(`${CORE_URL}/api/courses`, {
      form: coreCourseForm(instrId, overrides),
    });
    expect(coreRes.status()).toBe(201);
    const { id: coreCourseId } = await coreRes.json();

    const qmRes = await instrCtx.post(`${QM}/api/course`, { data: { coreCourseId } });
    // Idempotent ensure: 201 = created, 200 = background mirror anchored it first.
    expect([200, 201]).toContain(qmRes.status());
    const { data: qmCourse } = await qmRes.json();

    return { coreCourseId, qmCourseId: qmCourse.id };
  } finally {
    await adminCtx.dispose();
  }
}

/**
 * Create a Core course (admin) taught by a fresh instructor, enroll
 * `studentCtx` as STUDENT, and publish it, then create the QM anchor for it
 * as the student via `POST /api/course {coreCourseId}`.
 *
 * Publishing is required here even though it's not for the instructor path:
 * Core's `buildCourseListFilter` (apps/core/app/lib/auth/course-access.server.ts)
 * only includes a STUDENT-enrollment course in the caller's scoped list when
 * `isPublished: true` (the INSTRUCTOR/TA enrollment branch has no such gate).
 * QM's `POST /api/course` authorizes via `isCoreCourseInScopedList`, i.e. the
 * caller's own scoped Core list — so an unpublished course is invisible to
 * the enrolled student and QM would 403 without this step.
 */
export async function createQmCourseForStudent(
  playwright: PlaywrightRequestFixture,
  studentCtx: APIRequestContext,
  overrides: Record<string, string> = {},
): Promise<{ coreCourseId: string; qmCourseId: number }> {
  const adminCtx = await playwright.request.newContext();
  const instrCtx = await playwright.request.newContext();

  try {
    await createAdmin(adminCtx, { prefix: 'qm-course-admin' });
    await createInstructor(instrCtx, { prefix: 'qm-course-instr' });
    const { id: instrId } = await (await instrCtx.get(`${CORE_URL}/api/me`)).json();
    const { id: studentId } = await (await studentCtx.get(`${CORE_URL}/api/me`)).json();

    const coreRes = await adminCtx.post(`${CORE_URL}/api/courses`, {
      form: coreCourseForm(instrId, overrides),
    });
    expect(coreRes.status()).toBe(201);
    const { id: coreCourseId } = await coreRes.json();

    const enrollRes = await adminCtx.post(`${CORE_URL}/api/courses/${coreCourseId}/enrollments`, {
      data: { userId: studentId, role: 'STUDENT' },
    });
    expect(enrollRes.status()).toBe(201);

    const pubRes = await adminCtx.patch(`${CORE_URL}/api/courses/${coreCourseId}/publish`);
    expect(pubRes.status()).toBe(200);

    const qmRes = await studentCtx.post(`${QM}/api/course`, { data: { coreCourseId } });
    // Idempotent ensure: 201 = created, 200 = background mirror anchored it first.
    expect([200, 201]).toContain(qmRes.status());
    const { data: qmCourse } = await qmRes.json();

    return { coreCourseId, qmCourseId: qmCourse.id };
  } finally {
    await adminCtx.dispose();
    await instrCtx.dispose();
  }
}
