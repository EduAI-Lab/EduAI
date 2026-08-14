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
    // `GET /api/course` requires explicit pagination params (#1044) — a bare
    // call 400s with `PAGINATION_REQUIRED`.
    const listRes = await instrCtx.get(`${QM}/api/course?page=1&pageSize=100`);
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
    // September start — must agree with `term` above (August maps to S2 via
    // `termFromMonth`, the exact literal/startDate mismatch #1011 outlaws).
    startDate: '2026-09-08',
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
