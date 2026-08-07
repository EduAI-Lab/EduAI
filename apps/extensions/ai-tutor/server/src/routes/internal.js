/**
 * @file Server-to-server endpoints for Core to push into AI Tutor. Not reachable
 * by browser clients — every route here is gated by requireServiceKey instead
 * of the session-cookie requireAuth used elsewhere in this app, and is exempt
 * from the global `/api` auth gate in app.js.
 */
import express from 'express';
import { prisma } from '../config/database.js';
import { requireServiceKey } from '../middleware/serviceAuth.js';
import { clearEnrollmentSyncThrottle } from '../services/enrollmentSync.js';

const router = express.Router();

/**
 * DELETE /api/internal/courses/:coreOfferingId — cascade-delete AI Tutor's local
 * CourseOffering mirror when the course is deleted in Core (§802). Prisma's
 * `onDelete: Cascade` FKs (modules, lessons, activities, submissions, chat
 * sessions, enrollments, etc.) tear down every descendant in one statement.
 * Idempotent: responds 200 with `deleted: false` when no CourseOffering is
 * linked to that Core course.
 *
 * Looks up the local id(s) before deleting so the process-lifetime
 * `lastAutoSyncAt` throttle entries (enrollmentSync.js) can be evicted —
 * same requirement as reconcile.js's Phase 1 delete (#1173 review).
 */
router.delete('/internal/courses/:coreOfferingId', requireServiceKey, async (req, res, next) => {
  try {
    const offerings = await prisma.courseOffering.findMany({
      where: { coreOfferingId: req.params.coreOfferingId },
      select: { id: true },
    });

    const result = await prisma.courseOffering.deleteMany({
      where: { coreOfferingId: req.params.coreOfferingId },
    });

    for (const offering of offerings) {
      clearEnrollmentSyncThrottle(offering.id);
    }

    res.json({ success: true, deleted: result.count > 0 });
  } catch (error) {
    next(error);
  }
});

export default router;
