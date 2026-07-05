/**
 * Cross-service cascade-delete E2E test (#802).
 *
 * When a course is deleted in Core, Core pushes a best-effort delete to both
 * QM (`DELETE /api/internal/courses/:coreCourseId`) and AI Tutor
 * (`DELETE /api/internal/courses/:coreOfferingId`) before responding — see
 * apps/core/app/lib/courses/cascadeDelete.server.ts. This exercises the full
 * chain against real running services: create a Core course, mirror it into
 * both extensions, delete it in Core, and assert neither extension has an
 * orphaned copy left behind.
 */
import { test, expect } from '@playwright/test';
import { AI_TUTOR_API_URL, CORE_URL, QM_BACKEND_URL } from '../../playwright.config';
import { createAdmin, createInstructor } from '../helpers/auth';
import { importQmCourseForInstructor } from '../helpers/qm-courses';

const AT = AI_TUTOR_API_URL;
const QM = QM_BACKEND_URL;
const RUN_SUFFIX = Date.now().toString().slice(-5);

test.describe('Course deletion in Core cascades to QM and AI Tutor', () => {
  test('deleting a Core course removes the mirrored course from both extensions', async ({
    playwright,
  }) => {
    const adminCtx = await playwright.request.newContext();
    const instrCtx = await playwright.request.newContext();

    try {
      await createAdmin(adminCtx, { prefix: 'cascade-admin' });
      await createInstructor(instrCtx, { prefix: 'cascade-instr' });
      const { id: instrId } = await (await instrCtx.get(`${CORE_URL}/api/me`)).json();

      // Create a Core course assigned to the instructor.
      const createRes = await adminCtx.post(`${CORE_URL}/api/courses`, {
        form: {
          name: 'Cascade Delete Test Course',
          code: `CASC-${RUN_SUFFIX}`,
          section: '001',
          term: 'Fall',
          year: '2026',
          startDate: '2026-08-15',
          department: 'COSC',
          instructorUserIds: instrId,
        },
      });
      expect(createRes.status()).toBe(201);
      const { id: coreCourseId } = await createRes.json();

      // Mirror it into QM (auto-import-on-list) and AI Tutor (explicit import).
      const { qmCourseId } = await importQmCourseForInstructor(instrCtx, coreCourseId);

      const atImportRes = await instrCtx.post(`${AT}/api/courses/import-external`, {
        data: { externalCourseId: coreCourseId },
      });
      expect(atImportRes.status()).toBe(201);
      const { id: atCourseId } = await atImportRes.json();

      // Sanity check: both mirrors are visible before the delete.
      expect((await instrCtx.get(`${QM}/api/course/${qmCourseId}`)).status()).toBe(200);
      expect((await instrCtx.get(`${AT}/api/courses/${atCourseId}`)).status()).toBe(200);

      // Delete the course in Core (ADMIN rank).
      const deleteRes = await adminCtx.delete(`${CORE_URL}/api/courses/${coreCourseId}`);
      expect(deleteRes.status()).toBe(204);

      // Core's cascade push is fire-and-forget (it no longer blocks the 204
      // response — see apps/core/app/lib/courses/server.ts), so the extension
      // deletes may still be in flight when we get here. Poll until both settle.
      await expect
        .poll(async () => (await instrCtx.get(`${QM}/api/course/${qmCourseId}`)).status())
        .toBe(404);
      await expect
        .poll(async () => (await instrCtx.get(`${AT}/api/courses/${atCourseId}`)).status())
        .toBe(404);
    } finally {
      await adminCtx.dispose();
      await instrCtx.dispose();
    }
  });
});
