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
import {
  parsePaginationParams,
  paginated,
  parseSearchParam,
  searchWhere,
  PaginationError,
} from '../utils/pagination.js';
import { syncExternalCourseTopics, AUTO_SYNC_TTL_MS, AUTO_SYNC_TIMEOUT_MS } from '../services/topicSync.js';

const router = express.Router();

/**
 * Largest `IN` list we put in one statement. `mappings` is caller-controlled
 * and the activity ids derived from it are unbounded (a source topic can be a
 * secondary on any number of activities), while Postgres caps a single
 * statement at 65535 bind parameters — so the id lists get chunked rather than
 * failing the whole remap on a bind-message error (#1372).
 */
const ID_CHUNK_SIZE = 5000;

function chunkIds(ids, size = ID_CHUNK_SIZE) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) {
    out.push(ids.slice(i, i + size));
  }
  return out;
}

/**
 * Pre-load the `ActivitySecondaryTopic` rows a whole remap request needs, so
 * the per-pair loop reads from memory instead of issuing two queries per pair
 * (#1372).
 *
 * Only sound when the pairs don't observe each other's writes:
 *   - a source topic repeated across pairs (`A→B`, `A→C`) means the second
 *     pair must see rows the first already deleted;
 *   - a chain (`A→B`, `B→C`) means the second pair must see rows the first
 *     just created on B.
 * A snapshot taken before the loop is stale in both cases, so those requests
 * fall back to the original per-pair reads. Fan-in (`A→C`, `B→C`) is fine:
 * the target rows one pair adds are only ever re-added by another, and
 * `createMany({ skipDuplicates })` absorbs that against the
 * `@@id([activityId, topicId])` primary key.
 *
 * Returns `null` when batching is unsafe.
 */
async function preloadSecondaryTopics(tx, courseId, normalized) {
  const fromTopicIds = normalized.map((m) => m.fromTopicId);
  const toTopicIds = new Set(normalized.map((m) => m.toTopicId));
  const independent =
    new Set(fromTopicIds).size === fromTopicIds.length &&
    !fromTopicIds.some((id) => toTopicIds.has(id));
  if (!independent) {
    return null;
  }

  const sourceRows = await tx.activitySecondaryTopic.findMany({
    where: {
      topicId: { in: fromTopicIds },
      activity: { lesson: { module: { courseOfferingId: courseId } } },
    },
    select: { activityId: true, topicId: true },
  });

  const sourceByTopic = new Map();
  const allActivityIds = new Set();
  for (const row of sourceRows) {
    if (!sourceByTopic.has(row.topicId)) sourceByTopic.set(row.topicId, new Set());
    sourceByTopic.get(row.topicId).add(row.activityId);
    allActivityIds.add(row.activityId);
  }

  const targetByTopic = new Map();
  for (const activityIds of chunkIds(Array.from(allActivityIds))) {
    const targetRows = await tx.activitySecondaryTopic.findMany({
      where: {
        topicId: { in: Array.from(toTopicIds) },
        activityId: { in: activityIds },
      },
      select: { activityId: true, topicId: true },
    });
    for (const row of targetRows) {
      if (!targetByTopic.has(row.topicId)) targetByTopic.set(row.topicId, new Set());
      targetByTopic.get(row.topicId).add(row.activityId);
    }
  }

  return { sourceByTopic, targetByTopic };
}

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

    // #1207: `search` narrows in SQL on the topic name. Topic <Select>
    // dropdowns still need their saved value present, so the client fetches a
    // missing saved topic by id rather than assuming it is on the loaded page.
    const pageParams = parsePaginationParams(req, { required: false, defaultPageSize: 200 });
    const search = parseSearchParam(req);
    const searchFragment = searchWhere(search, ['name']);
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
        console.warn(`[topics] Auto-sync (${phase}) failed for course ${courseId}, serving local mirror: ${e.message}`);
      }
    }

    const [total, topics] = await prisma.$transaction([
      prisma.topic.count({ where: whereClause }),
      prisma.topic.findMany({
        where: whereClause,
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
 *
 * Query cost (#1372): `mappings` length is caller-controlled and the whole
 * batch runs in one transaction holding row locks, so per-pair reads were the
 * expensive part. Topic resolution is now a single `findMany` for the entire
 * request, and the `ActivitySecondaryTopic` reads are hoisted too whenever the
 * pairs are independent (see `preloadSecondaryTopics`). On that path the writes
 * collapse as well — one `createMany`, one `deleteMany`, one `topic.deleteMany`
 * for the whole batch — so roughly 8N queries drop to N + 6, with only the
 * main-topic `updateMany` left per pair (each carries different `data`).
 * Requests whose pairs observe each other keep the per-pair path.
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

    // Serializable: the reads this route batches (topic ownership, the
    // `ActivitySecondaryTopic` snapshot) are now taken once for the whole
    // request instead of once per pair, so a concurrent remap or activity
    // edit committing mid-batch would otherwise be applied against a stale
    // snapshot and silently reported as `{ ok: true }`. Under SSI that
    // interleaving aborts with a serialization failure and the caller retries.
    // Remap is a rare, admin-only cleanup call, so the contention cost is nil.
    await prisma.$transaction(async (tx) => {
      // Every topic id is known before the loop starts, so resolve them in one
      // read instead of two `findUnique` calls per pair (#1372). Scoping the
      // query to `courseOfferingId` collapses "no such topic" and "belongs to
      // another course" into a single set — the per-pair checks below already
      // treated those two states identically.
      const allTopicIds = Array.from(
        new Set(normalized.flatMap((m) => [m.fromTopicId, m.toTopicId])),
      );
      const ownedTopics = await tx.topic.findMany({
        where: { id: { in: allTopicIds }, courseOfferingId: courseId },
        select: { id: true },
      });
      const ownedTopicIds = new Set(ownedTopics.map((t) => t.id));

      // Each iteration deletes its own `fromTopicId`, so a later pair naming a
      // consumed topic has to keep failing the ownership check the way the
      // per-pair `findUnique` made it. Track the deletes instead of re-reading.
      const deletedTopicIds = new Set();
      const isUsable = (id) => ownedTopicIds.has(id) && !deletedTopicIds.has(id);

      // Reject unknown/foreign topics before touching the join table, so a bad
      // request costs one read instead of the full preload it would roll back
      // anyway. The per-pair `isUsable` checks below still run: they also cover
      // "consumed by an earlier pair", which this pre-pass can't see.
      for (const { fromTopicId, toTopicId } of normalized) {
        if (!ownedTopicIds.has(fromTopicId)) {
          throw new Error('fromTopicId does not belong to this course');
        }
        if (!ownedTopicIds.has(toTopicId)) {
          throw new Error('toTopicId does not belong to this course');
        }
      }

      // Best-effort topic delete. `Activity.mainTopicId` is the only restricting
      // FK (`ActivitySecondaryTopic` cascades), so filtering on it reproduces
      // "skip the ones still referenced" without letting a failed DELETE abort
      // the transaction — a caught FK error still leaves Postgres in 25P02, so
      // every later statement, or the COMMIT itself, would fail silently.
      const deleteTopicIfUnused = async (ids) => {
        if (ids.length === 0) return;
        for (const chunk of chunkIds(ids)) {
          const { count } = await tx.topic.deleteMany({
            where: { id: { in: chunk }, mainActivities: { none: {} } },
          });
          if (count === chunk.length) {
            for (const id of chunk) deletedTopicIds.add(id);
          } else {
            // Partial: re-read to learn which ones actually went.
            const left = await tx.topic.findMany({
              where: { id: { in: chunk } },
              select: { id: true },
            });
            const survived = new Set(left.map((t) => t.id));
            for (const id of chunk) if (!survived.has(id)) deletedTopicIds.add(id);
          }
        }
      };

      const preloaded = await preloadSecondaryTopics(tx, courseId, normalized);

      if (preloaded) {
        // Pairs are proven independent here, so no pair observes another's
        // writes: every secondary-relation write collapses into one statement
        // instead of four per pair (#1372). Only the main-topic reassignment
        // stays per-pair — each carries different `data`.
        const fromTopicIds = normalized.map((m) => m.fromTopicId);
        const createRows = [];
        const queuedRows = new Set();
        const sourceActivityIds = new Set();

        for (const { fromTopicId, toTopicId } of normalized) {
          await tx.activity.updateMany({
            where: {
              mainTopicId: fromTopicId,
              lesson: { module: { courseOfferingId: courseId } },
            },
            data: { mainTopicId: toTopicId },
          });

          const have = preloaded.targetByTopic.get(toTopicId) ?? new Set();
          for (const activityId of preloaded.sourceByTopic.get(fromTopicId) ?? []) {
            sourceActivityIds.add(activityId);
            // Fan-in (`A→C`, `B→C`) reads the same snapshot twice, so dedupe
            // the queued rows as well as the ones the snapshot already has.
            const key = `${activityId} ${toTopicId}`;
            if (have.has(activityId) || queuedRows.has(key)) continue;
            queuedRows.add(key);
            createRows.push({ activityId, topicId: toTopicId });
          }
        }

        if (createRows.length > 0) {
          await tx.activitySecondaryTopic.createMany({
            data: createRows,
            skipDuplicates: true,
          });
        }
        for (const activityIds of chunkIds(Array.from(sourceActivityIds))) {
          await tx.activitySecondaryTopic.deleteMany({
            where: { topicId: { in: fromTopicIds }, activityId: { in: activityIds } },
          });
        }
        await deleteTopicIfUnused(fromTopicIds);
        return;
      }

      for (const { fromTopicId, toTopicId } of normalized) {
        // Re-check: an earlier pair in this batch may have consumed the topic.
        if (!isUsable(fromTopicId)) {
          throw new Error('fromTopicId does not belong to this course');
        }
        if (!isUsable(toTopicId)) {
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

        for (const chunk of chunkIds(activityIds)) {
          // Create missing target relations
          const existingTarget = await tx.activitySecondaryTopic.findMany({
            where: { topicId: toTopicId, activityId: { in: chunk } },
            select: { activityId: true },
          });
          const have = new Set(existingTarget.map((e) => e.activityId));
          const toCreate = chunk.filter((id) => !have.has(id));
          if (toCreate.length > 0) {
            await tx.activitySecondaryTopic.createMany({
              data: toCreate.map((id) => ({ activityId: id, topicId: toTopicId })),
              skipDuplicates: true,
            });
          }

          // Remove old relations
          await tx.activitySecondaryTopic.deleteMany({
            where: { topicId: fromTopicId, activityId: { in: chunk } },
          });
        }

        // Delete the old topic now that it's unused
        await deleteTopicIfUnused([fromTopicId]);
      }
    }, { isolationLevel: 'Serializable' });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
