/**
 * Server-to-server endpoints for Core to push into QM. Not reachable by browser
 * clients — every route here is gated by requireServiceKey instead of a user session.
 */
import express from 'express';
import { prisma } from '../config/database.js';
import { requireServiceKey } from '../middleware/serviceAuth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * DELETE /api/internal/courses/:coreCourseId — cascade-delete QM's local course
 * mirror (and everything hanging off it — topics, questions, assessments,
 * variants) when the course is deleted in Core (§802). Idempotent: responds
 * 200 with `deleted: false` when no QM course is linked to that Core course.
 */
router.delete('/courses/:coreCourseId', requireServiceKey, async (req, res, next) => {
  try {
    const course = await prisma.course.findUnique({ where: { coreCourseId: req.params.coreCourseId } });

    if (!course) {
      return res.json({ success: true, deleted: false });
    }

    await prisma.course.delete({ where: { id: course.id } });
    logger.info(`[internal] Deleted QM Course ${course.id} (Core course ${req.params.coreCourseId} deleted)`);

    res.json({ success: true, deleted: true });
  } catch (error) {
    next(error);
  }
});

export default router;
