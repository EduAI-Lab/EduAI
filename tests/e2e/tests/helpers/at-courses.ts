import { expect, type APIRequestContext } from '@playwright/test';
import { AI_TUTOR_API_URL, CORE_URL } from '../../playwright.config';
import { createAdmin } from './auth';

const AT = AI_TUTOR_API_URL;
const RUN_SUFFIX = Date.now().toString().slice(-5);

type PlaywrightRequestFixture = {
  request: { newContext: () => Promise<APIRequestContext> };
};

function coreCourseForm(instrId: string, overrides: Record<string, string> = {}) {
  const { code: codeBase, ...rest } = overrides;
  return {
    name: 'E2E AT Course',
    code: `${codeBase ?? 'AT-E2E'}-${RUN_SUFFIX}-${Math.floor(Math.random() * 1e4)}`,
    section: '001',
    term: 'W1',
    year: '2026',
    startDate: '2026-09-08',
    department: 'COSC',
    instructorUserIds: instrId,
    ...rest,
  };
}

/** Create a Core course (admin) assigned to the instructor, then mirror it into AI Tutor. */
export async function importAtCourseForInstructor(
  playwright: PlaywrightRequestFixture,
  instrCtx: APIRequestContext,
  overrides: Record<string, string> = {},
): Promise<{ coreCourseId: string; atCourseId: number }> {
  const adminCtx = await playwright.request.newContext();

  try {
    await createAdmin(adminCtx, { prefix: 'at-course-admin' });
    const { id: instrId } = await (await instrCtx.get(`${CORE_URL}/api/me`)).json();

    const coreRes = await adminCtx.post(`${CORE_URL}/api/courses`, {
      form: coreCourseForm(instrId, overrides),
    });
    expect(coreRes.status()).toBe(201);
    const { id: coreCourseId } = await coreRes.json();

    const listRes = await instrCtx.get(`${AT}/api/courses`);
    expect(listRes.status()).toBe(200);
    const courses = await listRes.json();
    let atCourse = courses.find(
      (c: { coreOfferingId?: string; externalId?: string }) =>
        c.coreOfferingId === coreCourseId || c.externalId === coreCourseId,
    );

    if (!atCourse) {
      const importRes = await instrCtx.post(`${AT}/api/courses/import-external`, {
        data: { externalCourseId: coreCourseId },
      });
      // Import is an idempotent ensure: 201 = created here, 200 = the
      // throttled background mirror won the race and anchored it first.
      expect([200, 201]).toContain(importRes.status());
      atCourse = await importRes.json();
    }

    return { coreCourseId, atCourseId: atCourse.id };
  } finally {
    await adminCtx.dispose();
  }
}
