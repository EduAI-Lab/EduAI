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
 *     drift away upstream. Drift is surfaced via the `missingTopics` array so
 *     the instructor can act on it deliberately.
 *   - Remap rewrites both `Activity.mainTopicId` and the
 *     `ActivitySecondaryTopic` join table inside a transaction, then drops the
 *     source topic. If the source is still referenced (e.g. another module),
 *     the delete is best-effort and silently skipped.
 * Related: services/topicSync.js, services/eduaiAuth.js
 */

import express from 'express';
import { prisma } from '../config/database.js';
import { requireRole } from '../middleware/auth.js';
import { getEduAiAccessTokenForUser } from '../services/eduaiAuth.js';
import { syncExternalCourseTopics } from '../services/topicSync.js';

const router = express.Router();

async function ensureCourseAccess(courseId, userId) {
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

  return { course, authorized: isInstructor || isStudent, isInstructor };
}

/**
 * GET /courses/:courseId/topics — list topics for a course.
 *
 * Auth: enrolled student or course instructor.
 *
 * Why: deliberately does NOT auto-sync from EduAI; sync is an explicit
 * instructor action so the topic list never changes underneath an active UI.
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
    const { course, authorized } = await ensureCourseAccess(courseId, req.user.id);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    if (!authorized) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    // Do not auto-sync here to avoid surprising UI changes.
    // Imported courses can be synced explicitly via the sync endpoint.

    const topics = await prisma.topic.findMany({
      where: { courseOfferingId: courseId },
      orderBy: { name: 'asc' },
    });
    res.json(topics);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * POST /courses/:courseId/topics — create a topic on a native course.
 *
 * Auth: instructor on the course.
 * Side effects: inserts a Topic row; 409 on unique-name collision.
 *
 * Why: blocked for imported courses — those topics are owned by EduAI and a
 * manual addition would be wiped on next sync (or worse, drift silently).
 */
router.post('/courses/:courseId/topics', requireRole('PROFESSOR'), async (req, res) => {
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
    const { course, isInstructor } = await ensureCourseAccess(courseId, instructor.id);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    if (!isInstructor) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    // Block manual topic creation for imported (external) courses
    if (course.externalId) {
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
 * Auth: instructor on the course; course must be EduAI-imported.
 * Returns: `{ ok, topics, missingTopics }` — `missingTopics` are local topics
 *   no longer present upstream (informational; nothing is deleted).
 * Side effects: upserts Topic rows by name within the course scope.
 *
 * Why: name-keyed additive sync preserves activity references even if a topic
 * is renamed upstream — the instructor can use `/topics/remap` to consolidate.
 */
router.post('/courses/:courseId/topics/sync', requireRole('PROFESSOR'), async (req, res) => {
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
    const isInstructor = course.instructors.some((i) => i.userId === instructor.id);
    if (!isInstructor) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    if (!course.externalId) {
      return res.status(400).json({ error: 'Course is not imported from EduAI' });
    }

    let upstreamNames = [];
    try {
      const eduAiAccessToken = await getEduAiAccessTokenForUser(instructor.id);
      const { topics: synced, upstreamNames: upstream } = await syncExternalCourseTopics(courseId, {
        accessToken: eduAiAccessToken,
      });
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
 * Auth: instructor on the course.
 * Body: `{ mappings: [{ fromTopicId, toTopicId }, ...] }`
 * Side effects: in a single transaction, reassigns `Activity.mainTopicId`,
 *   migrates `ActivitySecondaryTopic` rows (creating missing target rows,
 *   deleting source rows), then deletes each source topic if no longer used.
 *
 * Why: post-sync cleanup tool — when EduAI renames or splits a topic, the
 * instructor uses this to consolidate the orphaned local topic into the new
 * upstream-synced one without losing activity associations.
 */
router.post('/courses/:courseId/topics/remap', requireRole('PROFESSOR'), async (req, res) => {
  const instructor = req.user;
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: 'Invalid course id' });
  }

  const mappings = Array.isArray(req.body?.mappings) ? req.body.mappings : [];
  const normalized = mappings
    .map((m) => ({ fromTopicId: Number(m?.fromTopicId), toTopicId: Number(m?.toTopicId) }))
    .filter(
      (m) =>
        Number.isFinite(m.fromTopicId) &&
        Number.isFinite(m.toTopicId) &&
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
    const isInstructor = course.instructors.some((i) => i.userId === instructor.id);
    if (!isInstructor) return res.status(403).json({ error: 'Not authorized for this course' });

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
