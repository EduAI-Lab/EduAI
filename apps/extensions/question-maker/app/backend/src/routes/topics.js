/**
 * Router for topic sync diagnostics (API path `/api/topics`).
 *
 * The pull-and-upsert sync itself already lives at `POST /api/course/:id/sync-topics`
 * (course.js → topicSyncService), so this router only exposes a read-only
 * sync-status report. Routes are per-course access gated (rbac-matrix §8, TA+).
 */
import express from 'express';
import { Topics } from '../schema/index.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireCourseAccess } from '../middleware/courseAccess.js';
import { getCourseTopicsFromCore } from '../services/coreApiService.js';

const router = express.Router();

/** Resolves the QM course id from the URL param for per-course access gates. */
const courseIdFromParam = (req) => req.params.courseId;

/**
 * GET /api/topics/sync-status/:courseId – reports whether local QM topics are in
 * sync with Core (§8 view topics: TA access or above).
 *
 * `coreCount` derives from the Core topics service, `localCount` from the local
 * Topics table; `inSync` is true only when the counts match AND every local topic
 * carries a `coreTopicId`. `lastSyncedAt` is the most recent updatedAt among
 * already-linked local topics (no dedicated sync-timestamp column exists), or null.
 */
router.get(
  '/sync-status/:courseId',
  authenticateToken,
  requireCourseAccess({ min: 'ta', getCourseId: courseIdFromParam }),
  async (req, res, next) => {
    try {
      const course = req.qmCourse;

      const localTopics = await Topics.findAll({ where: { courseId: course.id } });
      const localCount = localTopics.length;
      const linkedTopics = localTopics.filter((t) => t.coreTopicId);
      const allLinked = localCount > 0 && linkedTopics.length === localCount;

      const lastSyncedAt = linkedTopics.length
        ? new Date(Math.max(...linkedTopics.map((t) => new Date(t.updatedAt).getTime()))).toISOString()
        : null;

      // Not linked to Core: nothing to sync against; report 0 core topics.
      let coreCount = 0;
      if (course.coreCourseId) {
        const data = await getCourseTopicsFromCore(course.coreCourseId, {
          cookie: req.headers.cookie,
        });
        const coreTopics = Array.isArray(data?.topics) ? data.topics : Array.isArray(data) ? data : [];
        coreCount = coreTopics.length;
      }

      const inSync = localCount === coreCount && allLinked;

      res.json({
        success: true,
        data: {
          inSync,
          localCount,
          coreCount,
          lastSyncedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
