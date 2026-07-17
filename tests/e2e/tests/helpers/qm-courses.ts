import { expect, type APIRequestContext } from '@playwright/test';
import { QM_BACKEND_URL } from '../../playwright.config';

const QM = QM_BACKEND_URL;

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
