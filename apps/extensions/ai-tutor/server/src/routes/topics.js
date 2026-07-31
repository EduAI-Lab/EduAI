/**
 * @file Course-scoped topic management: list, create, EduAI sync, and remap.
 *
 * Responsibility: Owns the Topic table for a course offering — both
 *   instructor-authored topics for native courses and EduAI-synced topics for
 *   imported courses.
 * Callers: Mounted under `/api`; consumed by the instructor topic UI and any
 *   activity-create flow that picks a `mainTopicId`/`secondaryTopicIds`.
 * Gotchas:
 *   - Topics for imported (EduAI) courses are managed exclusively by sync;
 *     manual creation is rejected (POST /courses/:id/topics).
 *   - Sync is name-keyed and additive — it never deletes local topics that
 *     drift away upstream. Drift is surfaced via the `missingTopics` array on
 *     the deprecated POST .../sync response, but as of #1031 there is no UI
 *     surface left that reads it (TopicSyncMappingDialog was removed) —
 *     drifted local topics now accumulate silently rather than being
 *     resolved. POST .../remap still exists to consolidate them by hand via
 *     direct API call, but is otherwise dead code.
 *   - GET auto-syncs from Core for imported courses (#1031); POST .../sync
 *     and POST .../remap are kept for API compatibility but are no longer
 *     called by the UI. This means any enrolled student's read can now
 *     trigger a Core call + local `createMany`, where before sync was an
 *     explicit admin-only action — deliberate, so the topic list is current
 *     without a manual step; `AUTO_SYNC_TTL_MS` caps the resulting Core/DB
 *     load to at most one sync per course per TTL window regardless of how
 *     many students are reading concurrently. `jobs/reconcile.js` still owns
 *     periodic reconciliation independent of reads; this is a read-time
 *     top-up on top of that, not a replacement for it.
 *   - Remap rewrites both `Activity.mainTopicId` and the
 *     `ActivitySecondaryTopic` join table inside a transaction, then drops the
 *     source topic. If the source is still referenced (e.g. another module),
 *     the delete is best-effort and silently skipped.
 * Related: services/topicSync.js, services/eduaiAuth.js
 */

import express from 'express';
import { prisma } from '../config/database.js';
import { requireRole, isCourseAdmin } from '../middleware/auth.js';
import { mapTopic } from '../utils/mappers.js';
import { parsePaginationParams, paginated, PaginationError } from '../utils/pagination.js';
import { syncExternalCourseTopics, AUTO_SYNC_TTL_MS, AUTO_SYNC_TIMEOUT_MS } from '../services/topicSync.js';

const router = express.Router();

async function ensureCourseAccess(courseId, user) {
  const userId = user?.id;
  const course = await prisma.courseOffering.findUnique({
    where: { id: courseId },
    include: {
      instructors: true,
      enrollments: true,
    },
  });

  if (!course) {
    return { course: null, authorized: false };
  }

  const isInstructor = course.instructors.some((assignment) => assignment.userId === userId);
  const isStudent = course.enrollments.some((enrollment) => enrollment.userId === userId);
  // Platform admins can read any course's topics (admin ⊇ instructor).
  const isAdmin = user?.role === 'ADMIN';

  return { course, authorized: isAdmin || isInstructor || isStudent, isInstructor };
}

/**
 * GET /courses/:courseId/topics — list topics for a course.
 *
 * Auth: enrolled student or course instructor.
 *
 * Why: Core is the source of truth for topics. For EduAI-imported courses,
 * this pulls the latest topic list from Core before responding, so the topic
 * list is always current without a manual sync action. Pulls are throttled
 * per course to `AUTO_SYNC_TTL_MS` (services/topicSync.js) so a page with
 * many concurrent viewers doesn't fire a Core call per request, and bounded
 * to `AUTO_SYNC_TIMEOUT_MS` so a Core that's up but slow/hung degrades to
 * the local mirror the same way a hard failure does, instead of blocking
 * the request on the OS socket timeout. A failed or timed-out pull (Core
 * fetch or local write) falls back to serving the local mirror rather than
 * failing the request — mirrors the tolerance pattern in jobs/reconcile.js.
 */
router.get('/courses/:courseId/topics', async (req, res) => {
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: 'Invalid course id' });
  }
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const { course, authorized } = await ensureCourseAccess(courseId, req.user);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    if (!authorized) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    // Structure-bounded list. Topic <Select> dropdowns `.find()` the saved
    // value and validate with `.some()`, so the picker needs the whole set;
    // callers request one bounded page (pageSize=200). Pagination optional.
    const pageParams = parsePaginationParams(req, { required: false, defaultPageSize: 200 });

    // For imported courses, run sync for its upsert side-effect (it keeps the
    // local mirror current); its returned list is intentionally ignored so the
    // response always comes from one paginated local read below — the sync
    // return is unpaginated and would break the envelope's count/skip/take.
    if (course.coreOfferingId) {
      try {
        await syncExternalCourseTopics(courseId, {
          ttlMs: AUTO_SYNC_TTL_MS,
          signal: AbortSignal.timeout(AUTO_SYNC_TIMEOUT_MS),
        });
      } catch (e) {
        const phase = e?.phase === 'write' ? 'local write' : 'Core fetch';
        console.warn(`[topics] Auto-sync (${phase}) failed for course ${courseId}, serving local mirror: ${e.message}`);
      }
    }

    const [total, topics] = await prisma.$transaction([
      prisma.topic.count({ where: { courseOfferingId: courseId } }),
      prisma.topic.findMany({
        where: { courseOfferingId: courseId },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: pageParams.skip,
        take: pageParams.take,
      }),
    ]);
    res.json(paginated(topics.map(mapTopic), total, pageParams));
  } catch (e) {
    if (e instanceof PaginationError) {
      return res.status(e.status).json({ error: e.message, code: e.code });
    }
    res.status(500).json({ error: String(e) });
  }
});

/**
 * POST /courses/:courseId/topics — create a topic on a native course.
 *
 * Auth: course admin (LEAD instructor / unit-admin / admin).
 * Side effects: inserts a Topic row; 409 on unique-name collision.
 *
 * Why: blocked for imported courses — those topics are owned by EduAI and a
 * manual addition would be wiped on next sync (or worse, drift silently).
 */
router.post('/courses/:courseId/topics', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  const instructor = req.user;
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: 'Invalid course id' });
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    const { course } = await ensureCourseAccess(courseId, instructor);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    if (!await isCourseAdmin(instructor, course)) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    // Block manual topic creation for imported (external) courses
    if (course.coreOfferingId) {
      return res.status(403).json({
        error: 'Topics for imported courses are managed by EduAI and cannot be added here',
      });
    }

    const topic = await prisma.topic.create({
      data: {
        name,
        courseOfferingId: courseId,
      },
    });

    res.status(201).json(topic);
  } catch (e) {
    if (e?.code === 'P2002') {
      return res.status(409).json({ error: 'Topic name already exists for this course' });
    }
    res.status(500).json({ error: String(e) });
  }
});

export default router;

/**
 * POST /courses/:courseId/topics/sync — pull EduAI topic list into local DB.
 *
 * Deprecated (#1031): the UI no longer calls this — GET .../topics now
 * auto-syncs imported courses on every read. Kept unreachable-from-UI for API
 * compatibility, same treatment as the old `POST /courses/import-external`
 * (see docs/ARCHITECTURE.md §8).
 *
 * Auth: course admin (LEAD instructor / unit-admin / admin); course must be
 *   EduAI-imported.
 * Returns: `{ ok, topics, missingTopics }` — `missingTopics` are local topics
 *   no longer present upstream (informational; nothing is deleted).
 * Side effects: upserts Topic rows by name within the course scope.
 *
 * Why: name-keyed additive sync preserves activity references even if a topic
 * is renamed upstream — the instructor can use `/topics/remap` to consolidate.
 */
router.post('/courses/:courseId/topics/sync', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  const instructor = req.user;
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: 'Invalid course id' });
  }

  try {
    const course = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: { instructors: { select: { userId: true } } },
    });
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    if (!await isCourseAdmin(instructor, course)) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    if (!course.coreOfferingId) {
      return res.status(400).json({ error: 'Course is not imported from EduAI' });
    }

    let upstreamNames = [];
    try {
      const { topics: synced, upstreamNames: upstream } = await syncExternalCourseTopics(courseId);
      upstreamNames = upstream || [];
    } catch (e) {
      const status = Number.isInteger(e?.status) ? e.status : 502;
      return res.status(status).json({ error: e?.message || 'Failed to sync topics from EduAI' });
    }

    const topics = await prisma.topic.findMany({
      where: { courseOfferingId: courseId },
      orderBy: { name: 'asc' },
    });
    const upstreamSet = new Set(upstreamNames);
    const missingTopics = topics.filter((t) => !upstreamSet.has(t.name));
    res.json({ ok: true, topics, missingTopics });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * POST /courses/:courseId/topics/remap — move activities between topics.
 *
 * Deprecated (#1031): the UI no longer surfaces this — TopicSyncMappingDialog
 * (the only caller) was removed along with the "Sync now" button. Kept
 * unreachable-from-UI for API compatibility, same treatment as the now-dead
 * `POST /courses/:courseId/topics/sync` above.
 *
 * Auth: course admin (LEAD instructor / unit-admin / admin).
 * Body: `{ mappings: [{ fromTopicId, toTopicId }, ...] }`
 * Side effects: in a single transaction, reassigns `Activity.mainTopicId`,
 *   migrates `ActivitySecondaryTopic` rows (creating missing target rows,
 *   deleting source rows), then deletes each source topic if no longer used.
 *
 * Why: post-sync cleanup tool — when EduAI renames or splits a topic, an
 * admin can still consolidate the orphaned local topic into the new
 * upstream-synced one without losing activity associations, via direct API
 * call. Since GET .../topics now auto-syncs (#1031) and there's no UI path
 * to `missingTopics` anymore, drifted local topics otherwise pile up
 * silently — this is the only remaining way to clean them up.
 */
router.post('/courses/:courseId/topics/remap', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  const instructor = req.user;
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: 'Invalid course id' });
  }

  const mappings = Array.isArray(req.body?.mappings) ? req.body.mappings : [];
  const normalized = mappings
    .map((m) => ({ fromTopicId: String(m?.fromTopicId ?? ''), toTopicId: String(m?.toTopicId ?? '') }))
    .filter(
      (m) =>
        m.fromTopicId.length > 0 &&
        m.toTopicId.length > 0 &&
        m.fromTopicId !== m.toTopicId,
    );

  if (normalized.length === 0) {
    return res.status(400).json({ error: 'No valid mappings provided' });
  }

  try {
    const course = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: { instructors: { select: { userId: true } } },
    });
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (!await isCourseAdmin(instructor, course)) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    await prisma.$transaction(async (tx) => {
      for (const { fromTopicId, toTopicId } of normalized) {
        // Validate topics belong to this course
        const [fromTopic, toTopic] = await Promise.all([
          tx.topic.findUnique({ where: { id: fromTopicId } }),
          tx.topic.findUnique({ where: { id: toTopicId } }),
        ]);
        if (!fromTopic || fromTopic.courseOfferingId !== courseId) {
          throw new Error('fromTopicId does not belong to this course');
        }
        if (!toTopic || toTopic.courseOfferingId !== courseId) {
          throw new Error('toTopicId does not belong to this course');
        }

        // Reassign main topics
        await tx.activity.updateMany({
          where: {
            mainTopicId: fromTopicId,
            lesson: { module: { courseOfferingId: courseId } },
          },
          data: { mainTopicId: toTopicId },
        });

        // Reassign secondary topics: create missing target relations, then delete old relations
        const secondary = await tx.activitySecondaryTopic.findMany({
          where: {
            topicId: fromTopicId,
            activity: { lesson: { module: { courseOfferingId: courseId } } },
          },
          select: { activityId: true },
        });
        const activityIds = Array.from(new Set(secondary.map((s) => s.activityId)));

        if (activityIds.length > 0) {
          // Create missing target relations
          const existingTarget = await tx.activitySecondaryTopic.findMany({
            where: { topicId: toTopicId, activityId: { in: activityIds } },
            select: { activityId: true },
          });
          const have = new Set(existingTarget.map((e) => e.activityId));
          const toCreate = activityIds.filter((id) => !have.has(id));
          if (toCreate.length > 0) {
            await tx.activitySecondaryTopic.createMany({
              data: toCreate.map((id) => ({ activityId: id, topicId: toTopicId })),
              skipDuplicates: true,
            });
          }

          // Remove old relations
          await tx.activitySecondaryTopic.deleteMany({
            where: { topicId: fromTopicId, activityId: { in: activityIds } },
          });
        }

        // Attempt to delete the old topic now that it’s unused
        try {
          await tx.topic.delete({ where: { id: fromTopicId } });
        } catch (_) {
          // If still referenced somehow, leave it.
        }
      }
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
