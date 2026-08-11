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
import { logSafeError, sendSafeError } from '../utils/safeErrors.js';
import {
  parsePaginationParams,
  paginated,
  parseSearchParam,
  searchWhere,
  PaginationError,
} from '../utils/pagination.js';
import {
  syncExternalCourseTopics,
  AUTO_SYNC_TTL_MS,
  AUTO_SYNC_TIMEOUT_MS,
} from '../services/topicSync.js';
import {
  ensureCourseTopicAccess,
  remapCourseTopics,
  TopicMutationError,
} from '../services/topicManagement.js';

const router = express.Router();

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
router.get("/courses/:courseId/topics", async (req, res) => {
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: "Invalid course id" });
  }
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const { course, authorized } = await ensureCourseTopicAccess(courseId, req.user);
    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }
    if (!authorized) {
      return res.status(403).json({ error: "Not authorized for this course" });
    }

    // #1207: `search` narrows in SQL on the topic name. Topic <Select>
    // dropdowns still need their saved value present, so the client fetches a
    // missing saved topic by id rather than assuming it is on the loaded page.
    const pageParams = parsePaginationParams(req, { required: false, defaultPageSize: 200 });
    const search = parseSearchParam(req);
    const searchFragment = searchWhere(search, ["name"]);
    const scope = { courseOfferingId: courseId };
    const whereClause = searchFragment ? { AND: [scope, searchFragment] } : scope;

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
        logSafeError(`[topics] Auto-sync (${phase}) failed; serving local mirror`, e);
      }
    }

    const [total, topics] = await prisma.$transaction([
      prisma.topic.count({ where: whereClause }),
      prisma.topic.findMany({
        where: whereClause,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: pageParams.skip,
        take: pageParams.take,
      }),
    ]);
    res.json(paginated(topics.map(mapTopic), total, pageParams));
  } catch (e) {
    if (e instanceof PaginationError) {
      return res.status(e.status).json({ error: e.message, code: e.code });
    }
    sendSafeError(res, e, 'Internal server error');
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
router.post(
  '/courses/:courseId/topics',
  requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']),
  async (req, res) => {
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
      const { course } = await ensureCourseTopicAccess(courseId, instructor);
      if (!course) {
        return res.status(404).json({ error: 'Course not found' });
      }
      if (!(await isCourseAdmin(instructor, course))) {
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
      sendSafeError(res, e, 'Internal server error');
    }
  },
);

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
router.post(
  '/courses/:courseId/topics/sync',
  requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']),
  async (req, res) => {
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
      if (!(await isCourseAdmin(instructor, course))) {
        return res.status(403).json({ error: 'Not authorized for this course' });
      }

      if (!course.coreOfferingId) {
        return res.status(400).json({ error: 'Course is not imported from EduAI' });
      }

      let upstreamNames = [];
      try {
        const { upstreamNames: upstream } = await syncExternalCourseTopics(courseId);
        upstreamNames = upstream || [];
      } catch (e) {
        const status = Number.isInteger(e?.status) ? e.status : 502;
        logSafeError('[topics] Explicit sync failed', e);
        return sendSafeError(res, e, 'Failed to sync topics from EduAI', { status });
      }

      const topics = await prisma.topic.findMany({
        where: { courseOfferingId: courseId },
        orderBy: { name: 'asc' },
      });
      const upstreamSet = new Set(upstreamNames);
      const missingTopics = topics.filter((t) => !upstreamSet.has(t.name));
      res.json({ ok: true, topics, missingTopics });
    } catch (e) {
      sendSafeError(res, e, 'Internal server error');
    }
  },
);

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
 *
 * Query cost (#1372): `mappings` length is caller-controlled and the whole
 * batch runs in one transaction holding row locks, so per-pair reads were the
 * expensive part. Topic resolution is now a single `findMany` for the entire
 * request, and the `ActivitySecondaryTopic` reads are hoisted too whenever the
 * pairs are independent (see `services/topicManagement.js`). On that path the writes
 * collapse as well — one `createMany`, one `deleteMany`, one `topic.deleteMany`
 * for the whole batch — so roughly 8N queries drop to N + 6, with only the
 * main-topic `updateMany` left per pair (each carries different `data`).
 * Requests whose pairs observe each other keep the per-pair path.
 */
router.post(
  '/courses/:courseId/topics/remap',
  requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']),
  async (req, res) => {
    const instructor = req.user;
    const courseId = Number(req.params.courseId);
    if (!Number.isFinite(courseId)) {
      return res.status(400).json({ error: 'Invalid course id' });
    }

    try {
      await remapCourseTopics({
        courseId,
        user: instructor,
        body: req.body,
      });
      res.json({ ok: true });
    } catch (e) {
      if (e instanceof TopicMutationError) {
        return res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
      }
      sendSafeError(res, e, 'Internal server error');
    }
  },
);
