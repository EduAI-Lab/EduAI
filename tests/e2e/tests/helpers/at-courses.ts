import { expect, type APIRequestContext } from '@playwright/test';
import { AI_TUTOR_API_URL, CORE_URL } from '../../playwright.config';
import { createAdmin } from './auth';
import { atListData } from './at-pagination';

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

    const courses = await atListData<{ coreOfferingId?: string; externalId?: string; id: number }>(
      instrCtx,
      `${AT}/api/courses`,
    );
    const existing = courses.find(
      (c) => c.coreOfferingId === coreCourseId || c.externalId === coreCourseId,
    );

    if (existing) {
      return { coreCourseId, atCourseId: existing.id };
    }

    const importRes = await instrCtx.post(`${AT}/api/courses/import-external`, {
      data: { externalCourseId: coreCourseId },
    });
    // Import is an idempotent ensure: 201 = created here, 200 = the
    // throttled background mirror won the race and anchored it first.
    expect([200, 201]).toContain(importRes.status());
    const imported = (await importRes.json()) as { id: number };

    return { coreCourseId, atCourseId: imported.id };
  } finally {
    await adminCtx.dispose();
  }
}
