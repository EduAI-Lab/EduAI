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
import {
  findEduAiCourseById,
  listCoreAdminUsers,
  listEduAiCourseEnrollmentsServiceKey,
  listEduAiCourses,
  setCoreCoursePublishState,
} from '../services/eduaiClient.js';
import { mapEduAiServiceKeyError } from '../services/eduaiServiceKeyErrors.js';
import { getEduAiCookieForRequest } from '../services/eduaiAuth.js';
import { syncCourseEnrollments } from '../services/enrollmentSync.js';
import {
  importEnrolledCoursesFromCore,
  importExternalCourseForUser,
  importTaughtCoursesFromCore,
} from '../services/importTaughtCoursesService.js';
import { listAdminBugReports } from '../services/bugReports.js';

const router = express.Router();

function isSupportedCourseRole(role) {
  return (
    role === 'INSTRUCTOR' ||
    role === 'STUDENT' ||
    role === 'TA' ||
    role === 'UNIT_ADMIN' ||
    role === 'ADMIN'
  );
}

async function userHasTaEnrollment(userId) {
  const count = await prisma.courseEnrollment.count({
    where: { userId, role: 'TA' },
  });
  return count > 0;
}

/**
 * Pull the MCQ option labels out of a freeform `Activity.config`. Mirrors the
 * `options` normalization in `mapActivity` — accepts the modern
 * `{ options: { choices: [] } }` shape and the legacy bare-array form. Returns
 * `null` when the activity carries no choices (e.g. short-answer questions).
 */
function extractChoices(config) {
  if (!config || typeof config !== 'object') return null;
  const { options } = config;
  if (options == null) return null;
  if (Array.isArray(options)) return options;
  if (Array.isArray(options.choices)) return options.choices;
  return null;
}

function respondEduAiUpstreamError(res, error, fallbackMessage) {
  const mapped = mapEduAiServiceKeyError(error);
  if (mapped) {
    return res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
  }
  const status = Number.isInteger(error?.status) ? error.status : 502;
  return res.status(status).json({ error: error.message || fallbackMessage });
}

/**
 * GET /eduai/courses — list importable EduAI courses for the instructor.
 *
 * Auth: INSTRUCTOR.
 * Returns: EduAI course descriptors minus any already imported by this
 *   instructor (de-duped via local `externalId`).
 *
 * Why: filtering by THIS instructor (not globally) lets multiple instructors
 * import the same EduAI course independently into their own offerings.
 */
router.get('/eduai/courses', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  try {
    // #578: list the caller's Core-scoped courses using their session cookie
    // (the service key would return the full catalog). Mirrors the import path.
    const courses = await listEduAiCourses({ cookie: req.headers.cookie });

    // Exclude any EduAI course already mirrored into AI Tutor. coreOfferingId is
    // @unique (one offering per Core course globally), so a hit on either the Core
    // link or the legacy externalId means the course is already in the system.
    const imported = await prisma.courseOffering.findMany({
      where: {
        externalSource: 'EDUAI',
        OR: [{ coreOfferingId: { not: null } }, { externalId: { not: null } }],
      },
      select: { coreOfferingId: true, externalId: true },
    });

    const importedIds = new Set();
    for (const row of imported) {
      if (row.coreOfferingId) importedIds.add(row.coreOfferingId);
      if (row.externalId) importedIds.add(row.externalId);
    }
    const filtered = Array.isArray(courses)
      ? courses.filter((c) => c && typeof c.id === 'string' && !importedIds.has(c.id))
      : [];

    res.json(filtered);
  } catch (error) {
    console.error('[eduai] Failed to list courses', error);
    return respondEduAiUpstreamError(res, error, 'Unable to fetch EduAI courses');
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
    if (authUser.role === 'STUDENT' || authUser.role === 'TA') {
      try {
        await importEnrolledCoursesFromCore(authUser, getEduAiCookieForRequest(req));
      } catch (err) {
        console.error('[eduai] Core enrollment mirror failed on list', err);
      }
    }

    if (authUser.role === 'ADMIN') {
      // Platform admins see every course offering (no progress) so the shared
      // Courses dashboard lists all courses they can open and edit.
      const courses = await prisma.courseOffering.findMany({
        orderBy: { createdAt: 'desc' },
      });
      res.json(courses.map(mapCourseOffering));
    } else if (authUser.role === 'INSTRUCTOR') {
      try {
        await importTaughtCoursesFromCore(authUser, getEduAiCookieForRequest(req));
      } catch (err) {
        console.error('[eduai] Core course mirror failed on list', err);
      }

      const courses = await prisma.courseOffering.findMany({
        where: { instructors: { some: { userId: authUser.id } } },
        orderBy: { createdAt: 'desc' },
      });
      res.json(courses.map(mapCourseOffering));
    } else if (authUser.role === 'UNIT_ADMIN') {
      // UNIT_ADMINs see every course in their authorized units (regardless of
      // publish state), plus any course they personally lead — so the courses
      // they create or import are always visible even before a department is set.
      const units = Array.isArray(authUser.authorizedUnits) ? authUser.authorizedUnits : [];
      const courses = await prisma.courseOffering.findMany({
        where: {
          OR: [
            ...(units.length > 0 ? [{ department: { in: units } }] : []),
            { instructors: { some: { userId: authUser.id } } },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
      res.json(courses.map(mapCourseOffering));
    } else if (authUser.role === 'TA' || (authUser.role === 'STUDENT' && await userHasTaEnrollment(authUser.id))) {
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
    // #578: only courses in the instructor's Core-scoped list are importable.
    // A miss means the caller is not authorized for this Core course (not a 404).
    const externalCourse = await findEduAiCourseById(externalCourseId, { cookie: req.headers.cookie });
    if (!externalCourse) {
      return res.status(403).json({ error: 'CORE_COURSE_NOT_AUTHORIZED' });
    }

    // coreOfferingId is @unique — one AI Tutor offering per Core course regardless of instructor.
    const { offering, created } = await importExternalCourseForUser(instructor, externalCourse);
    if (!created) {
      return res.status(409).json({ error: 'Course already imported' });
    }

    res.status(201).json(mapCourseOffering(offering));
  } catch (error) {
    console.error('[eduai] Failed to import course', error);
    return respondEduAiUpstreamError(res, error, 'Unable to import course');
  }
});

/**
 * POST /courses/:courseId/sync-enrollments — refresh student enrollments from Core (#578).
 *
 * Auth: course admin (LEAD instructor / unit-admin / admin).
 * Only EduAI-imported courses can sync; a native course has no Core roster to
 * pull from, so it returns 400 rather than a misleading empty sync.
 */
router.post('/courses/:courseId/sync-enrollments', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
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
    if (course.externalSource !== 'EDUAI' || !course.externalId) {
      return res.status(400).json({ error: 'Course was not imported from EduAI' });
    }

    const result = await syncCourseEnrollments(courseId, { course });
    res.json(result);
  } catch (error) {
    console.error('[eduai] Failed to sync enrollments', error);
    return respondEduAiUpstreamError(res, error, 'Unable to sync enrollments');
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

    const isAdmin = authUser.role === 'ADMIN';
    const isInstructor = course.instructors.some((i) => i.userId === authUser.id);
    const enrollment = course.enrollments.find((e) => e.userId === authUser.id);
    const unitAdmin = isUnitAdminForCourse(authUser, course);
    const isMember = isAdmin || isInstructor || enrollment != null || unitAdmin;

    if (!isMember) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    res.json(mapCourseOffering(course));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * POST /courses — deprecated (#632). Course creation is owned by EduAI Core.
 * Always returns 403 so legacy clients cannot create offerings locally.
 */
router.post('/courses', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (_req, res) => {
  return res.status(403).json({
    error:
      'Course creation is managed in EduAI Core. Import or enable courses from Core instead.',
  });
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
 * Auth: ADMIN (global), UNIT_ADMIN (D-scoped), INSTRUCTOR (C-scoped).
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

    // #477: write through to Core first. If Core rejects, surface 500 and leave
    // local state untouched so the two never diverge silently.
    if (course.coreOfferingId) {
      await setCoreCoursePublishState(course.coreOfferingId, true);
    }

    const updated = await prisma.courseOffering.update({
      where: { id: courseId },
      data: { isPublished: true },
    });

    res.json(mapCourseOffering(updated));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * PATCH /courses/:courseId/unpublish — flip course unpublished, cascading down.
 *
 * Auth: ADMIN (global), UNIT_ADMIN (D-scoped), INSTRUCTOR (C-scoped).
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

    // #477: write through to Core first; a Core failure aborts the local cascade.
    if (courseForAuth.coreOfferingId) {
      await setCoreCoursePublishState(courseForAuth.coreOfferingId, false);
    }

    // Unpublish course and cascade to all modules and lessons
    await prisma.$transaction(async (tx) => {
      // Update the course
      await tx.courseOffering.update({
        where: { id: courseId },
        data: { isPublished: false },
      });

      // Update all modules in this course
      await tx.module.updateMany({
        where: { courseOfferingId: courseId },
        data: { isPublished: false },
      });

      // Update all lessons in modules of this course
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
 * GET /courses/:courseId/feedback — all ActivityFeedback in the course.
 *
 * Auth: ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C) / TA(C). STUDENT → 403.
 * Query params: activityId, studentId, take (default 50, max 200), skip (default 0).
 */
router.get('/courses/:courseId/feedback', async (req, res) => {
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
    if (activityId !== undefined) {
      if (!Number.isFinite(Number(activityId))) {
        return res.status(400).json({ error: 'activityId must be a number' });
      }
      where.activityId = Number(activityId);
    }
    if (studentId) where.userId = studentId;

    const feedback = await prisma.activityFeedback.findMany({
      where,
      orderBy: [{ activityId: 'asc' }, { userId: 'asc' }, { createdAt: 'asc' }],
      take,
      skip,
    });

    res.json(feedback);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

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
    if (activityId !== undefined) {
      if (!Number.isFinite(Number(activityId))) {
        return res.status(400).json({ error: 'activityId must be a number' });
      }
      where.activityId = Number(activityId);
    }
    if (studentId) where.userId = studentId;

    const submissions = await prisma.submission.findMany({
      where,
      orderBy: [{ activityId: 'asc' }, { userId: 'asc' }, { attemptNumber: 'asc' }],
      take,
      skip,
      include: {
        activity: {
          select: {
            id: true,
            title: true,
            config: true,
            lesson: { select: { title: true } },
          },
        },
      },
    });

    // Resolve Core-owned student names (identity lives in Core, not this DB).
    // Best-effort: a missing service key or Core hiccup falls back to the raw
    // userId so the panel still renders.
    const nameById = new Map();
    if (course.coreOfferingId) {
      try {
        const enrollments = await listEduAiCourseEnrollmentsServiceKey(course.coreOfferingId);
        for (const enrollment of enrollments) {
          if (enrollment?.studentId) nameById.set(enrollment.studentId, enrollment.studentName);
        }
      } catch {
        // Leave the map empty; rows degrade to the userId.
      }
    }

    const enriched = submissions.map((submission) => {
      const { activity, ...rest } = submission;
      const config = activity?.config ?? {};
      const choices = extractChoices(config);
      const response = rest.response ?? null;
      // MCQ picks store a zero-based option index; map it back to the option
      // label so instructors read the answer, not "Option 3".
      const optionIndex =
        response && typeof response.answerOption === 'number' ? response.answerOption : null;
      const answerLabel =
        optionIndex != null && choices && choices[optionIndex] != null
          ? choices[optionIndex]
          : null;
      return {
        ...rest,
        studentName: nameById.get(rest.userId) ?? null,
        activityTitle: activity?.title ?? null,
        lessonTitle: activity?.lesson?.title ?? null,
        questionText: config.question ?? config.prompt ?? null,
        answerLabel,
      };
    });

    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * GET /courses/:courseId/student-metrics — per-student aggregated metrics.
 *
 * Auth: ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C) / TA(C).
 */
router.get('/courses/:courseId/student-metrics', async (req, res) => {
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
 * Auth: ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C) / TA(C).
 */
router.get('/courses/:courseId/analytics', async (req, res) => {
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

// ── Dashboard rollups (§938) ─────────────────────────────────────

/**
 * GET /me/dashboard-stats — role-aware aggregate rollup across the caller's
 * visible courses.
 *
 * Auth: any authenticated user; response shape is scoped by role.
 * Returns numbers backed only by local tables (CourseOffering,
 * CourseEnrollment, Submission) plus, for ADMIN, counts sourced from the
 * existing Core admin-user / bug-report service calls already used elsewhere
 * in this file — never fabricated fields.
 *
 * Why: STUDENT/TA/INSTRUCTOR/UNIT_ADMIN/ADMIN all want a different rollup, so
 * this branches on role the same way `GET /courses` does rather than trying
 * to force one shape onto every caller.
 */
router.get('/me/dashboard-stats', async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: 'Authentication required' });

  try {
    if (authUser.role === 'ADMIN') {
      const courses = await prisma.courseOffering.findMany({ select: { isPublished: true } });
      const publishedCourses = courses.filter((c) => c.isPublished).length;

      const stats = {
        role: 'ADMIN',
        totalCourses: courses.length,
        publishedCourses,
      };

      try {
        const users = await listCoreAdminUsers(req.headers.cookie ?? '');
        if (Array.isArray(users)) stats.totalUsers = users.length;
      } catch (err) {
        console.warn('[me/dashboard-stats] Could not fetch Core users', err.message);
      }

      try {
        const reports = await listAdminBugReports(getEduAiCookieForRequest(req));
        if (Array.isArray(reports)) {
          stats.openBugReports = reports.filter((r) => r.status === 'unhandled').length;
        }
      } catch (err) {
        console.warn('[me/dashboard-stats] Could not fetch bug reports', err.message);
      }

      return res.json(stats);
    }

    if (authUser.role === 'INSTRUCTOR' || authUser.role === 'UNIT_ADMIN') {
      const courseWhere =
        authUser.role === 'INSTRUCTOR'
          ? { instructors: { some: { userId: authUser.id } } }
          : {
              OR: [
                ...(Array.isArray(authUser.authorizedUnits) && authUser.authorizedUnits.length > 0
                  ? [{ department: { in: authUser.authorizedUnits } }]
                  : []),
                { instructors: { some: { userId: authUser.id } } },
              ],
            };

      const courses = await prisma.courseOffering.findMany({
        where: courseWhere,
        select: { id: true, isPublished: true },
      });
      const courseIds = courses.map((c) => c.id);
      const publishedCourses = courses.filter((c) => c.isPublished).length;

      let enrolledStudents = 0;
      let submissionsToReview = 0;
      if (courseIds.length > 0) {
        const distinctStudents = await prisma.courseEnrollment.findMany({
          where: { courseOfferingId: { in: courseIds }, role: 'STUDENT' },
          select: { userId: true },
          distinct: ['userId'],
        });
        enrolledStudents = distinctStudents.length;

        submissionsToReview = await prisma.submission.count({
          where: {
            isCorrect: null,
            activity: { lesson: { module: { courseOfferingId: { in: courseIds } } } },
          },
        });
      }

      return res.json({
        role: authUser.role,
        // Same value under two keys so the instructor view (yourCourses) and the
        // unit-admin view (totalCourses) each read the field they expect.
        yourCourses: courses.length,
        totalCourses: courses.length,
        publishedCourses,
        draftCourses: courses.length - publishedCourses,
        enrolledStudents,
        submissionsToReview,
      });
    }

    // TA — either the platform role is TA, or a STUDENT account also holds a
    // TA enrollment on at least one course (mirrors GET /courses §174).
    const isEffectiveTa =
      authUser.role === 'TA' || (authUser.role === 'STUDENT' && (await userHasTaEnrollment(authUser.id)));

    if (isEffectiveTa) {
      const taEnrollments = await prisma.courseEnrollment.findMany({
        where: { userId: authUser.id, role: 'TA' },
        select: { courseOfferingId: true },
      });
      const courseIds = taEnrollments.map((e) => e.courseOfferingId);

      const [submissionsToReview, publishedCourses] =
        courseIds.length > 0
          ? await Promise.all([
              prisma.submission.count({
                where: {
                  isCorrect: null,
                  activity: { lesson: { module: { courseOfferingId: { in: courseIds } } } },
                },
              }),
              prisma.courseOffering.count({
                where: { id: { in: courseIds }, isPublished: true },
              }),
            ])
          : [0, 0];

      return res.json({
        role: 'TA',
        yourCourses: courseIds.length,
        publishedCourses,
        submissionsToReview,
      });
    }

    // STUDENT (default)
    const enrollments = await prisma.courseEnrollment.findMany({
      where: { userId: authUser.id, role: 'STUDENT' },
      select: { courseOfferingId: true },
    });
    const enrolledCourseIds = enrollments.map((e) => e.courseOfferingId);
    const courses =
      enrolledCourseIds.length > 0
        ? await prisma.courseOffering.findMany({
            where: { id: { in: enrolledCourseIds }, isPublished: true },
            select: { id: true },
          })
        : [];

    const progresses = await Promise.all(
      courses.map((c) => calculateCourseProgress(c.id, authUser.id)),
    );
    const completedCourses = progresses.filter((p) => p.total > 0 && p.completed === p.total).length;
    const inProgressCourses = progresses.filter(
      (p) => p.total > 0 && p.completed > 0 && p.completed < p.total,
    ).length;

    const [correctCount, gradedCount] = await Promise.all([
      prisma.submission.count({ where: { userId: authUser.id, isCorrect: true } }),
      prisma.submission.count({ where: { userId: authUser.id, isCorrect: { not: null } } }),
    ]);
    const correctAnswerPercentage =
      gradedCount > 0 ? Math.round((correctCount / gradedCount) * 100) : 0;

    res.json({
      role: 'STUDENT',
      enrolledCourses: courses.length,
      coursesInProgress: inProgressCourses,
      coursesCompleted: completedCourses,
      correctAnswerPercentage,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * GET /me/notifications — small role-scoped notification-count object derived
 * from existing tables (Submission, CourseOffering, CourseEnrollment) plus,
 * for ADMIN, the existing Core bug-report admin service call.
 *
 * Auth: any authenticated user.
 * Returns: `{ ...counts, total }` where `counts` only includes keys the
 * caller's role actually has data for (e.g. STUDENT gets `{ total: 0 }`).
 */
router.get('/me/notifications', async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: 'Authentication required' });

  try {
    const counts = {};

    if (authUser.role === 'INSTRUCTOR' || authUser.role === 'UNIT_ADMIN') {
      const courseWhere =
        authUser.role === 'INSTRUCTOR'
          ? { instructors: { some: { userId: authUser.id } } }
          : {
              OR: [
                ...(Array.isArray(authUser.authorizedUnits) && authUser.authorizedUnits.length > 0
                  ? [{ department: { in: authUser.authorizedUnits } }]
                  : []),
                { instructors: { some: { userId: authUser.id } } },
              ],
            };
      const courses = await prisma.courseOffering.findMany({ where: courseWhere, select: { id: true } });
      const courseIds = courses.map((c) => c.id);

      counts.ungradedSubmissions =
        courseIds.length > 0
          ? await prisma.submission.count({
              where: {
                isCorrect: null,
                activity: { lesson: { module: { courseOfferingId: { in: courseIds } } } },
              },
            })
          : 0;
    } else if (
      authUser.role === 'TA' ||
      (authUser.role === 'STUDENT' && (await userHasTaEnrollment(authUser.id)))
    ) {
      const taEnrollments = await prisma.courseEnrollment.findMany({
        where: { userId: authUser.id, role: 'TA' },
        select: { courseOfferingId: true },
      });
      const courseIds = taEnrollments.map((e) => e.courseOfferingId);

      counts.ungradedSubmissions =
        courseIds.length > 0
          ? await prisma.submission.count({
              where: {
                isCorrect: null,
                activity: { lesson: { module: { courseOfferingId: { in: courseIds } } } },
              },
            })
          : 0;
    }

    if (authUser.role === 'ADMIN') {
      try {
        const reports = await listAdminBugReports(getEduAiCookieForRequest(req));
        counts.unhandledBugReports = Array.isArray(reports)
          ? reports.filter((r) => r.status === 'unhandled').length
          : 0;
      } catch (err) {
        console.warn('[me/notifications] Could not fetch bug reports', err.message);
        counts.unhandledBugReports = 0;
      }
    }

    const total = Object.values(counts).reduce(
      (sum, n) => sum + (Number.isFinite(n) ? n : 0),
      0,
    );
    res.json({ ...counts, total });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
