/**
 * @file Course offering listing, creation, EduAI import, content cloning, and
 *       publish/unpublish workflow.
 *
 * Responsibility: Owns the CourseOffering top-level lifecycle: instructor
 *   creates/imports/clones courses; students see only published ones with
 *   their progress.
 * Callers: Mounted under `/api`; consumed by the home, instructor, and student
 *   list pages plus the course-import dialogs.
 * Gotchas:
 *   - Listing is role-divergent: INSTRUCTOR sees all assigned courses regardless
 *     of publish state; STUDENT only sees `isPublished` courses they're enrolled
 *     in, with progress computed per course (N+1 by design — kept here, may
 *     warrant batching if course counts grow).
 *   - Importing from EduAI fans out into parallel topic + enrollment sync via
 *     `Promise.allSettled` so a partial upstream failure doesn't roll back the
 *     import itself; failures are logged.
 *   - Publish has no cascading; unpublish CASCADES to all child modules and
 *     lessons in a transaction so a student can never reach orphaned content.
 *   - `POST /courses` accepts an optional `sourceCourseId` to deep-clone
 *     content from another course the same instructor owns.
 * Related: services/eduaiClient.js, services/topicSync.js,
 *   services/enrollmentSync.js, services/courseCloning.js,
 *   services/progressCalculation.js
 */

import express from 'express';
import { prisma } from '../config/database.js';
import { requireRole, isUnitAdminForCourse, isCourseAdmin } from '../middleware/auth.js';
import { mapCourseOffering, mapProgressData } from '../utils/mappers.js';
import { cloneCourseContent, cloneLessonsFromOffering } from '../services/courseCloning.js';
import { calculateCourseProgress } from '../services/progressCalculation.js';
import { findEduAiCourseById, listEduAiCourses, setCoreCoursePublishState } from '../services/eduaiClient.js';
import { getEduAiCookieForRequest } from '../services/eduaiAuth.js';
import { syncExternalCourseTopics } from '../services/topicSync.js';
import { syncCourseEnrollments } from '../services/enrollmentSync.js';
import { importExternalCourseForUser } from '../services/importTaughtCoursesService.js';

const router = express.Router();

function isSupportedCourseRole(role) {
  return role === 'INSTRUCTOR' || role === 'STUDENT' || role === 'TA' || role === 'UNIT_ADMIN';
}

/**
 * GET /eduai/courses — list importable EduAI courses for the instructor.
 *
 * Auth: INSTRUCTOR.
 * Returns: EduAI course descriptors minus any already linked to a local
 *   offering (de-duped via `coreOfferingId`, which is @unique).
 *
 * Why: `coreOfferingId` is a unique constraint — one AI Tutor offering per
 * Core course — so filtering globally (not per-instructor) is correct.
 */
router.get('/eduai/courses', requireRole('INSTRUCTOR'), async (req, res) => {
  try {
    const cookie = getEduAiCookieForRequest(req);
    const courses = await listEduAiCourses({ cookie });

    // Exclude courses already linked to a local offering (by coreOfferingId, which is @unique).
    // Using coreOfferingId (not externalId + instructor) means seeded or cross-instructor
    // imports are also excluded — consistent with the one-Core-course-per-offering constraint.
    const imported = await prisma.courseOffering.findMany({
      where: { coreOfferingId: { not: null } },
      select: { coreOfferingId: true },
    });

    const importedIds = new Set(imported.map((c) => c.coreOfferingId).filter(Boolean));
    const filtered = Array.isArray(courses)
      ? courses.filter((c) => c && typeof c.id === 'string' && !importedIds.has(c.id))
      : [];

    res.json(filtered);
  } catch (error) {
    console.error('[eduai] Failed to list courses', error);
    const status = Number.isInteger(error?.status) ? error.status : 502;
    res.status(status).json({ error: error.message || 'Unable to fetch EduAI courses' });
  }
});

/**
 * GET /courses — list courses for the current user.
 *
 * Auth: INSTRUCTOR or STUDENT.
 * Returns: INSTRUCTOR → all instructor-assigned courses (no progress);
 *   STUDENT → published enrolled courses each with `progress`.
 *
 * Why: the two roles want fundamentally different shapes, so progress
 * computation is skipped entirely for instructors to keep their dashboard fast.
 */
router.get('/courses', async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: 'Authentication required' });
  if (!isSupportedCourseRole(authUser.role)) {
    return res.status(403).json({ error: 'Role is not supported in AI Tutor' });
  }

  try {
    if (authUser.role === 'INSTRUCTOR') {
      // Instructors see all their courses regardless of publish status (no progress)
      const courses = await prisma.courseOffering.findMany({
        where: { instructors: { some: { userId: authUser.id } } },
        orderBy: { createdAt: 'desc' },
      });
      res.json(courses.map(mapCourseOffering));
    } else if (authUser.role === 'UNIT_ADMIN') {
      // UNIT_ADMINs see all courses in their authorized units regardless of publish state (no progress).
      const units = Array.isArray(authUser.authorizedUnits) ? authUser.authorizedUnits : [];
      const courses = units.length > 0
        ? await prisma.courseOffering.findMany({
            where: { department: { in: units } },
            orderBy: { createdAt: 'desc' },
          })
        : [];
      res.json(courses.map(mapCourseOffering));
    } else if (authUser.role === 'TA') {
      // TAs see all TA-enrolled courses regardless of publish state (no progress),
      // plus published student-enrolled courses (with progress).
      const allEnrollments = await prisma.courseEnrollment.findMany({
        where: { userId: authUser.id },
        select: { courseOfferingId: true, role: true },
      });
      const taOfferingIds = allEnrollments
        .filter((e) => e.role === 'TA')
        .map((e) => e.courseOfferingId);
      const studentOfferingIds = allEnrollments
        .filter((e) => e.role === 'STUDENT')
        .map((e) => e.courseOfferingId);

      const taCourses = taOfferingIds.length > 0
        ? await prisma.courseOffering.findMany({
            where: { id: { in: taOfferingIds } },
            orderBy: { createdAt: 'desc' },
          })
        : [];

      const studentCourses = studentOfferingIds.length > 0
        ? await prisma.courseOffering.findMany({
            where: { id: { in: studentOfferingIds }, isPublished: true },
            orderBy: { createdAt: 'desc' },
          })
        : [];

      const studentCoursesWithProgress = await Promise.all(
        studentCourses.map(async (course) => {
          const progress = await calculateCourseProgress(course.id, authUser.id);
          return { ...mapCourseOffering(course), progress: mapProgressData(progress) };
        }),
      );

      res.json([...taCourses.map(mapCourseOffering), ...studentCoursesWithProgress]);
    } else {
      // Students only see published courses they're enrolled in (with progress)
      const courses = await prisma.courseOffering.findMany({
        where: {
          enrollments: { some: { userId: authUser.id } },
          isPublished: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      // Calculate progress for each course
      const coursesWithProgress = await Promise.all(
        courses.map(async (course) => {
          const progress = await calculateCourseProgress(course.id, authUser.id);
          return {
            ...mapCourseOffering(course),
            progress: mapProgressData(progress),
          };
        }),
      );

      res.json(coursesWithProgress);
    }
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * POST /courses/import-external — create a CourseOffering mirroring an EduAI course.
 *
 * Auth: INSTRUCTOR.
 * Side effects: creates CourseOffering + CourseInstructor inside a transaction,
 *   then fans out parallel topic + enrollment sync to EduAI; returns 409 if the
 *   instructor has already imported this externalCourseId.
 *
 * Why: post-create syncs run via `Promise.allSettled` so a flaky upstream call
 * for one of {topics, enrollments} doesn't block the other or roll back the
 * import. The instructor can rerun sync explicitly afterwards.
 */
router.post('/courses/import-external', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  const instructor = req.user;
  const { externalCourseId } = req.body || {};

  if (!externalCourseId || typeof externalCourseId !== 'string') {
    return res.status(400).json({ error: 'externalCourseId is required' });
  }

  try {
    const cookie = getEduAiCookieForRequest(req);
    const externalCourse = await findEduAiCourseById(externalCourseId, { cookie });
    if (!externalCourse) {
      return res.status(403).json({ error: 'CORE_COURSE_NOT_AUTHORIZED' });
    }

    // coreOfferingId is @unique — one AI Tutor offering per Core course regardless of instructor.
    const alreadyImported = await prisma.courseOffering.findFirst({
      where: { coreOfferingId: externalCourseId },
    });

    if (alreadyImported) {
      return res.status(409).json({ error: 'Course already imported' });
    }

    const { offering, created } = await importExternalCourseForUser(instructor, externalCourse);
    if (!created) {
      return res.status(409).json({ error: 'Course already imported' });
    }

    res.status(201).json(mapCourseOffering(offering));
  } catch (error) {
    console.error('[eduai] Failed to import course', error);
    const status = Number.isInteger(error?.status) ? error.status : 500;
    res.status(status).json({ error: error.message || 'Unable to import course' });
  }
});

router.get('/courses/:courseId', async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: 'Authentication required' });
  if (!isSupportedCourseRole(authUser.role)) {
    return res.status(403).json({ error: 'Role is not supported in AI Tutor' });
  }

  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: 'Invalid course id' });
  }

  try {
    const course = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: {
        instructors: { select: { userId: true } },
        enrollments: { select: { userId: true, role: true } },
      },
    });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const isInstructor = course.instructors.some((i) => i.userId === authUser.id);
    const enrollment = course.enrollments.find((e) => e.userId === authUser.id);
    const unitAdmin = isUnitAdminForCourse(authUser, course);
    const isMember = isInstructor || enrollment != null || unitAdmin;

    if (!isMember) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    res.json(mapCourseOffering(course));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * POST /courses/:courseId/sync-enrollments — refresh student enrollments from Core (#578).
 *
 * Auth: INSTRUCTOR assigned to the course.
 * Side effects: upserts local CourseEnrollment rows from Core STUDENT enrollments.
 */
router.post('/courses/:courseId/sync-enrollments', requireRole('INSTRUCTOR'), async (req, res) => {
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

    const isAssigned = course.instructors.some((i) => i.userId === instructor.id);
    if (!isAssigned) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    if (!course.externalId || course.externalSource !== 'EDUAI') {
      return res.status(400).json({ error: 'Course is not imported from EduAI' });
    }

    const result = await syncCourseEnrollments(courseId, { course });
    res.json(result);
  } catch (error) {
    console.error('[eduai] Instructor enrollment sync failed', error);
    const status = Number.isInteger(error?.status) ? error.status : 500;
    res.status(status).json({ error: error.message || 'Enrollment sync failed' });
  }
});

/**
 * POST /courses — create a native course, optionally cloning content from another.
 *
 * Auth: INSTRUCTOR; if `sourceCourseId` is given the caller must instruct it.
 * Side effects: creates CourseOffering + CourseInstructor; if cloning, deep-
 *   copies modules/lessons/activities via `cloneCourseContent`.
 *
 * Why: clone path lets instructors duplicate a previous term's course without
 * re-importing from EduAI or rebuilding lessons by hand.
 */
router.post('/courses', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  const authUser = req.user;
  const { title, description, sourceCourseId, startDate, endDate } = req.body || {};

  if (!title) {
    return res.status(400).json({ error: 'title is required' });
  }

  const numericSourceCourseId =
    typeof sourceCourseId === 'number' || typeof sourceCourseId === 'string'
      ? Number(sourceCourseId)
      : null;

  if (numericSourceCourseId !== null && !Number.isFinite(numericSourceCourseId)) {
    return res.status(400).json({ error: 'Invalid sourceCourseId' });
  }

  try {
    if (numericSourceCourseId !== null) {
      const sourceCourse = await prisma.courseOffering.findUnique({
        where: { id: numericSourceCourseId },
        include: { instructors: { select: { userId: true } } },
      });
      if (!sourceCourse || !isCourseAdmin(authUser, sourceCourse)) {
        return res.status(403).json({ error: 'Not authorized for source course' });
      }
    }

    const offering = await prisma.courseOffering.create({
      data: {
        title,
        description,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
      },
    });

    await prisma.courseInstructor.create({
      data: {
        courseOfferingId: offering.id,
        userId: authUser.id,
        role: 'LEAD',
      },
    });

    if (numericSourceCourseId !== null) {
      await cloneCourseContent(numericSourceCourseId, offering.id);
    }

    const created = await prisma.courseOffering.findUnique({
      where: { id: offering.id },
      include: {
        modules: {
          orderBy: { position: 'asc' },
          include: {
            lessons: { orderBy: { position: 'asc' } },
          },
        },
      },
    });

    res.status(201).json(created);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.patch('/courses/:courseId', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  const authUser = req.user;
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: 'Invalid course id' });
  }

  const { title, description, startDate, endDate } = req.body || {};

  if (!title && !description && !startDate && !endDate) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  try {
    const course = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: { instructors: { select: { userId: true } } },
    });
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (!isCourseAdmin(authUser, course)) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    const updated = await prisma.courseOffering.update({
      where: { id: courseId },
      data: {
        title: title ?? undefined,
        description: description ?? undefined,
        startDate: startDate ? new Date(startDate) : startDate === null ? null : undefined,
        endDate: endDate ? new Date(endDate) : endDate === null ? null : undefined,
      },
    });

    res.json(mapCourseOffering(updated));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * POST /courses/:courseId/import — selectively clone modules or lessons into
 * an existing course.
 *
 * Auth: INSTRUCTOR on both source and destination courses.
 * Body: either `{ sourceCourseId, moduleIds }` to clone whole modules, or
 *   `{ lessonIds, targetModuleId }` to clone individual lessons into a chosen
 *   destination module.
 * Side effects: deep-copies via `cloneCourseContent` / `cloneLessonsFromOffering`.
 *
 * Why: lesson-level imports require an explicit `targetModuleId` because
 * lessons have no implicit destination, whereas module-level imports preserve
 * their structure.
 */
router.post('/courses/:courseId/import', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  const authUser = req.user;
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: 'Invalid course id' });
  }

  const { sourceCourseId, moduleIds, lessonIds, targetModuleId } = req.body || {};

  const normalizedModuleIds = Array.isArray(moduleIds)
    ? moduleIds.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : [];

  const normalizedLessonIds = Array.isArray(lessonIds)
    ? lessonIds.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : [];

  const numericTargetModuleId =
    typeof targetModuleId === 'number' || typeof targetModuleId === 'string'
      ? Number(targetModuleId)
      : null;

  const numericSourceCourseId =
    typeof sourceCourseId === 'number' || typeof sourceCourseId === 'string'
      ? Number(sourceCourseId)
      : null;

  if (numericSourceCourseId !== null && !Number.isFinite(numericSourceCourseId)) {
    return res.status(400).json({ error: 'Invalid sourceCourseId' });
  }

  if (normalizedModuleIds.length === 0 && normalizedLessonIds.length === 0) {
    return res.status(400).json({ error: 'Nothing to import' });
  }

  try {
    const destCourse = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: { instructors: { select: { userId: true } } },
    });
    if (!destCourse) return res.status(404).json({ error: 'Course not found' });
    if (!isCourseAdmin(authUser, destCourse)) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    if (normalizedModuleIds.length > 0) {
      if (numericSourceCourseId === null) {
        return res.status(400).json({ error: 'sourceCourseId required when importing modules' });
      }

      const sourceCourse = await prisma.courseOffering.findUnique({
        where: { id: numericSourceCourseId },
        include: { instructors: { select: { userId: true } } },
      });
      if (!sourceCourse || !isCourseAdmin(authUser, sourceCourse)) {
        return res.status(403).json({ error: 'Not authorized for source course' });
      }

      const moduleCount = await prisma.module.count({
        where: {
          id: { in: normalizedModuleIds },
          courseOfferingId: numericSourceCourseId,
        },
      });

      if (moduleCount !== normalizedModuleIds.length) {
        return res
          .status(400)
          .json({ error: 'One or more modules do not belong to source course' });
      }

      await cloneCourseContent(numericSourceCourseId, courseId, {
        moduleIds: normalizedModuleIds,
      });
    }

    if (normalizedLessonIds.length > 0) {
      if (numericTargetModuleId === null || !Number.isFinite(numericTargetModuleId)) {
        return res.status(400).json({ error: 'targetModuleId required when importing lessons' });
      }

      const targetModule = await prisma.module.findUnique({
        where: { id: numericTargetModuleId },
        select: { courseOfferingId: true },
      });

      if (!targetModule || targetModule.courseOfferingId !== courseId) {
        return res
          .status(400)
          .json({ error: 'targetModuleId does not belong to destination course' });
      }

      const lessons = await prisma.lesson.findMany({
        where: { id: { in: normalizedLessonIds } },
        include: {
          module: { select: { courseOfferingId: true } },
        },
      });

      if (lessons.length !== normalizedLessonIds.length) {
        return res.status(400).json({ error: 'One or more lessons were not found' });
      }

      const sourceCourseIds = new Set(lessons.map((lesson) => lesson.module.courseOfferingId));

      for (const scId of sourceCourseIds) {
        const sc = await prisma.courseOffering.findUnique({
          where: { id: scId },
          include: { instructors: { select: { userId: true } } },
        });
        if (!sc || !isCourseAdmin(authUser, sc)) {
          return res.status(403).json({ error: 'Not authorized for lesson source course' });
        }
      }

      await cloneLessonsFromOffering(normalizedLessonIds, numericTargetModuleId);
    }

    const updated = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: {
        modules: {
          orderBy: { position: 'asc' },
          include: {
            lessons: {
              orderBy: { position: 'asc' },
              include: {
                activities: { orderBy: { position: 'asc' } },
              },
            },
          },
        },
      },
    });

    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * PATCH /courses/:courseId/publish — flip course to published.
 *
 * Auth: INSTRUCTOR on the course.
 *
 * Why: intentionally non-cascading. Publishing a course doesn't auto-publish
 * its modules/lessons; the instructor must opt them in individually so a
 * half-finished module can't leak to students.
 */
router.patch('/courses/:courseId/publish', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  const authUser = req.user;
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: 'Invalid course id' });
  }

  try {
    const course = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: { instructors: { select: { userId: true } } },
    });
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (!isCourseAdmin(authUser, course)) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    const offering = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      select: { coreOfferingId: true },
    });

    const updated = await prisma.courseOffering.update({
      where: { id: courseId },
      data: { isPublished: true },
    });

    // Write-through to Core after the local write succeeds — if Core rejects, roll back local.
    if (offering?.coreOfferingId) {
      try {
        await setCoreCoursePublishState(offering.coreOfferingId, true);
      } catch (coreErr) {
        await prisma.courseOffering.update({ where: { id: courseId }, data: { isPublished: false } });
        throw coreErr;
      }
    }

    res.json(mapCourseOffering(updated));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * PATCH /courses/:courseId/unpublish — flip course unpublished, cascading down.
 *
 * Auth: INSTRUCTOR on the course.
 * Side effects: in a single transaction sets `isPublished=false` on the
 *   course, all its modules, and all lessons within those modules.
 *
 * Why: the asymmetry with publish is deliberate — unpublishing must
 * immediately hide ALL child content from students; without the cascade a
 * module/lesson could remain reachable by direct URL.
 */
router.patch('/courses/:courseId/unpublish', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  const authUser = req.user;
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: 'Invalid course id' });
  }

  try {
    const courseForAuth = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: { instructors: { select: { userId: true } } },
    });
    if (!courseForAuth) return res.status(404).json({ error: 'Course not found' });
    if (!isCourseAdmin(authUser, courseForAuth)) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    const offering = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      select: { coreOfferingId: true },
    });

    // Cascade unpublish to modules and lessons (AI Tutor content hierarchy).
    await prisma.$transaction(async (tx) => {
      await tx.courseOffering.update({
        where: { id: courseId },
        data: { isPublished: false },
      });

      await tx.module.updateMany({
        where: { courseOfferingId: courseId },
        data: { isPublished: false },
      });

      const modules = await tx.module.findMany({
        where: { courseOfferingId: courseId },
        select: { id: true },
      });
      const moduleIds = modules.map((m) => m.id);

      if (moduleIds.length > 0) {
        await tx.lesson.updateMany({
          where: { moduleId: { in: moduleIds } },
          data: { isPublished: false },
        });
      }
    });

    // Write-through to Core after the cascade transaction completes — if Core rejects, throw.
    if (offering?.coreOfferingId) {
      await setCoreCoursePublishState(offering.coreOfferingId, false);
    }

    const updated = await prisma.courseOffering.findUnique({
      where: { id: courseId },
    });

    res.json(mapCourseOffering(updated));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Course-level analytics (§310) ─────────────────────────────────

/**
 * GET /courses/:courseId/submissions — all submissions in the course.
 *
 * Auth: ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C) / TA(C).
 * Query params: activityId, studentId, take (default 50, max 200), skip (default 0).
 */
router.get('/courses/:courseId/submissions', async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: 'Authentication required' });
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) return res.status(400).json({ error: 'Invalid course id' });

  try {
    const course = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: {
        instructors: { select: { userId: true } },
        enrollments: { select: { userId: true, role: true } },
      },
    });
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const hasAdminAccess = isCourseAdmin(authUser, course);
    const enrollment = course.enrollments.find((e) => e.userId === authUser.id);
    const isTa = enrollment?.role === 'TA';
    if (!hasAdminAccess && !isTa) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    const { activityId, studentId } = req.query;
    if (req.query.take !== undefined && !Number.isFinite(Number(req.query.take))) {
      return res.status(400).json({ error: 'take must be a number' });
    }
    if (req.query.skip !== undefined && !Number.isFinite(Number(req.query.skip))) {
      return res.status(400).json({ error: 'skip must be a number' });
    }
    const take = Math.min(Math.max(Number(req.query.take) || 50, 1), 200);
    const skip = Math.max(Number(req.query.skip) || 0, 0);

    const where = {
      activity: { lesson: { module: { courseOfferingId: courseId } } },
    };
    if (activityId) where.activityId = Number(activityId);
    if (studentId) where.userId = studentId;

    const submissions = await prisma.submission.findMany({
      where,
      orderBy: [{ activityId: 'asc' }, { userId: 'asc' }, { attemptNumber: 'asc' }],
      take,
      skip,
    });

    res.json(submissions);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * GET /courses/:courseId/student-metrics — per-student aggregated metrics.
 *
 * Auth: ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C). TA not admitted per §15.
 */
router.get('/courses/:courseId/student-metrics', async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: 'Authentication required' });
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) return res.status(400).json({ error: 'Invalid course id' });

  try {
    const course = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: { instructors: { select: { userId: true } } },
    });
    if (!course) return res.status(404).json({ error: 'Course not found' });

    if (!isCourseAdmin(authUser, course)) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    const rawMetrics = await prisma.activityStudentMetric.findMany({
      where: { activity: { lesson: { module: { courseOfferingId: courseId } } } },
    });

    const byStudent = {};
    for (const m of rawMetrics) {
      if (!byStudent[m.userId]) {
        byStudent[m.userId] = {
          userId: m.userId,
          submissionCount: 0,
          correctSubmissionCount: 0,
          incorrectSubmissionCount: 0,
          helpRequestCount: 0,
        };
      }
      byStudent[m.userId].submissionCount += m.submissionCount;
      byStudent[m.userId].correctSubmissionCount += m.correctSubmissionCount;
      byStudent[m.userId].incorrectSubmissionCount += m.incorrectSubmissionCount;
      byStudent[m.userId].helpRequestCount += m.helpRequestCount;
    }

    res.json(Object.values(byStudent));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * GET /courses/:courseId/analytics — per-activity aggregate analytics.
 *
 * Auth: ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C). TA not admitted per §15.
 */
router.get('/courses/:courseId/analytics', async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: 'Authentication required' });
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) return res.status(400).json({ error: 'Invalid course id' });

  try {
    const course = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: { instructors: { select: { userId: true } } },
    });
    if (!course) return res.status(404).json({ error: 'Course not found' });

    if (!isCourseAdmin(authUser, course)) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    const analytics = await prisma.activityAnalytics.findMany({
      where: { activity: { lesson: { module: { courseOfferingId: courseId } } } },
      include: { activity: { select: { id: true, title: true, lessonId: true } } },
      orderBy: { activityId: 'asc' },
    });

    res.json(analytics);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
