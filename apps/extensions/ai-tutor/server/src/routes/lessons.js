import express from 'express';
import { prisma } from '../config/database.js';
import { requireRole, isUnitAdminForCourse } from '../middleware/auth.js';
import { mapLesson, mapProgressData } from '../utils/mappers.js';
import { calculateLessonProgress } from '../services/progressCalculation.js';
import { isCoursePublishedLive } from '../services/courseResolver.js';

const router = express.Router();

router.get('/modules/:moduleId/lessons', async (req, res) => {
  const authUser = req.user;
  if (!authUser) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const moduleId = Number(req.params.moduleId);
  if (!Number.isFinite(moduleId)) {
    return res.status(400).json({ error: 'Invalid module id' });
  }

  try {
    const module = await prisma.module.findUnique({
      where: { id: moduleId },
      include: {
        courseOffering: {
          include: {
            instructors: { select: { userId: true } },
            enrollments: { select: { userId: true, role: true } },
          },
        },
      },
    });

    if (!module) {
      return res.status(404).json({ error: 'Module not found' });
    }

    const isInstructor = module.courseOffering.instructors.some((i) => i.userId === authUser.id);
    const enrollment = module.courseOffering.enrollments.find((e) => e.userId === authUser.id);
    const isTa = enrollment?.role === 'TA';
    const isStudent = enrollment?.role === 'STUDENT';
    const unitAdmin = await isUnitAdminForCourse(authUser, module.courseOffering);
    const isAdmin = authUser.role === 'ADMIN';
    const hasElevatedAccess = isAdmin || isInstructor || isTa || unitAdmin;
    const isMember = hasElevatedAccess || isStudent;

    if (!isMember) {
      return res.status(403).json({ error: 'Not authorized for this module' });
    }

    const whereClause = hasElevatedAccess
      ? { moduleId }
      : { moduleId, isPublished: true };

    const lessons = await prisma.lesson.findMany({
      where: whereClause,
      orderBy: { position: 'asc' },
    });

    // For students, add progress to each lesson
    if (isStudent && !hasElevatedAccess) {
      const lessonsWithProgress = await Promise.all(
        lessons.map(async (lesson) => {
          const progress = await calculateLessonProgress(lesson.id, authUser.id);
          return {
            ...mapLesson(lesson),
            progress: mapProgressData(progress),
          };
        }),
      );
      res.json(lessonsWithProgress);
    } else {
      res.json(lessons.map(mapLesson));
    }
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post('/modules/:moduleId/lessons', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  const authUser = req.user;
  const moduleId = Number(req.params.moduleId);
  if (!Number.isFinite(moduleId)) {
    return res.status(400).json({ error: 'Invalid module id' });
  }

  const { title, contentMd, position } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });

  try {
    const module = await prisma.module.findUnique({
      where: { id: moduleId },
      include: { courseOffering: { include: { instructors: { select: { userId: true } } } } },
    });
    if (!module) return res.status(404).json({ error: 'Module not found' });

    const isInstructor = module.courseOffering.instructors.some((i) => i.userId === authUser.id);
    const unitAdmin = await isUnitAdminForCourse(authUser, module.courseOffering);
    if (!isInstructor && !unitAdmin && authUser.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Not authorized for this module' });
    }

    // Append to the end of the module's lesson list when the client sends no
    // explicit position, rather than defaulting to 0 and pushing the new
    // lesson to the top (issue #1046 / #1047).
    let resolvedPosition;
    if (typeof position === 'number') {
      resolvedPosition = position;
    } else {
      const last = await prisma.lesson.findFirst({
        where: { moduleId },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      resolvedPosition = last ? last.position + 1 : 0;
    }

    const lesson = await prisma.lesson.create({
      data: {
        title,
        contentMd: contentMd ?? '',
        position: resolvedPosition,
        moduleId,
      },
    });
    res.status(201).json(mapLesson(lesson));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get('/lessons/:lessonId', async (req, res) => {
  const authUser = req.user;
  if (!authUser) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const lessonId = Number(req.params.lessonId);
  if (!Number.isFinite(lessonId)) {
    return res.status(400).json({ error: 'Invalid lesson id' });
  }

  try {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        module: {
          include: {
            courseOffering: {
              include: {
                instructors: { select: { userId: true } },
                enrollments: { select: { userId: true, role: true } },
              },
            },
          },
        },
      },
    });
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    const isInstructor = lesson.module.courseOffering.instructors.some(
      (i) => i.userId === authUser.id,
    );
    const enrollment = lesson.module.courseOffering.enrollments.find(
      (e) => e.userId === authUser.id,
    );
    const isTa = enrollment?.role === 'TA';
    const isStudent = enrollment?.role === 'STUDENT';
    const unitAdmin = await isUnitAdminForCourse(authUser, lesson.module.courseOffering);
    const isAdmin = authUser.role === 'ADMIN';
    const hasElevatedAccess = isAdmin || isInstructor || isTa || unitAdmin;
    const isMember = hasElevatedAccess || isStudent;

    if (!isMember) {
      return res.status(403).json({ error: 'Not authorized for this lesson' });
    }
    if (isStudent && !hasElevatedAccess && !lesson.isPublished) {
      return res.status(403).json({ error: 'Lesson is not published' });
    }

    res.json(mapLesson(lesson));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Publish a lesson (requires parent module AND course to be published)
router.patch('/lessons/:lessonId/publish', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  const instructor = req.user;
  const lessonId = Number(req.params.lessonId);
  if (!Number.isFinite(lessonId)) {
    return res.status(400).json({ error: 'Invalid lesson id' });
  }

  try {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        module: {
          include: {
            courseOffering: {
              include: { instructors: { select: { userId: true } } },
            },
          },
        },
      },
    });

    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    const isInstructor = lesson.module.courseOffering.instructors.some(
      (i) => i.userId === instructor.id,
    );
    const unitAdmin = await isUnitAdminForCourse(instructor, lesson.module.courseOffering);
    if (!isInstructor && !unitAdmin && instructor.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Not authorized for this lesson' });
    }

    // Validate parent course is published — `isPublished` is Core-owned
    // (#1072 step 4), resolved live rather than read off the local row.
    if (!(await isCoursePublishedLive(lesson.module.courseOffering.coreOfferingId))) {
      return res.status(400).json({
        error: 'Cannot publish lesson: parent course is not published',
      });
    }

    // Validate parent module is published
    if (!lesson.module.isPublished) {
      return res.status(400).json({
        error: 'Cannot publish lesson: parent module is not published',
      });
    }

    const updated = await prisma.lesson.update({
      where: { id: lessonId },
      data: { isPublished: true },
    });

    res.json(mapLesson(updated));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Unpublish a lesson (no cascading, lessons have no children)
router.patch('/lessons/:lessonId/unpublish', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  const instructor = req.user;
  const lessonId = Number(req.params.lessonId);
  if (!Number.isFinite(lessonId)) {
    return res.status(400).json({ error: 'Invalid lesson id' });
  }

  try {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        module: {
          include: {
            courseOffering: {
              include: { instructors: { select: { userId: true } } },
            },
          },
        },
      },
    });

    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    const isInstructor = lesson.module.courseOffering.instructors.some(
      (i) => i.userId === instructor.id,
    );
    const unitAdmin = await isUnitAdminForCourse(instructor, lesson.module.courseOffering);
    if (!isInstructor && !unitAdmin && instructor.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Not authorized for this lesson' });
    }

    const updated = await prisma.lesson.update({
      where: { id: lessonId },
      data: { isPublished: false },
    });

    res.json(mapLesson(updated));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.delete('/lessons/:lessonId', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  const authUser = req.user;
  const lessonId = Number(req.params.lessonId);
  if (!Number.isFinite(lessonId)) {
    return res.status(400).json({ error: 'Invalid lesson id' });
  }

  try {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        module: {
          include: {
            courseOffering: {
              include: { instructors: { select: { userId: true } } },
            },
          },
        },
      },
    });

    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    const isInstructor = lesson.module.courseOffering.instructors.some(
      (i) => i.userId === authUser.id,
    );
    const unitAdmin = await isUnitAdminForCourse(authUser, lesson.module.courseOffering);
    const isAdmin = authUser.role === 'ADMIN';
    if (!isInstructor && !unitAdmin && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized for this lesson' });
    }

    await prisma.lesson.delete({ where: { id: lessonId } });
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.patch('/lessons/:lessonId', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  const authUser = req.user;
  const lessonId = Number(req.params.lessonId);
  if (!Number.isFinite(lessonId)) {
    return res.status(400).json({ error: 'Invalid lesson id' });
  }

  const { title, contentMd, position } = req.body || {};
  if (title === undefined && contentMd === undefined && position === undefined) {
    return res.status(400).json({ error: 'Nothing to update' });
  }
  if (title !== undefined && !title) {
    return res.status(400).json({ error: 'title cannot be empty' });
  }
  const numericPosition = position !== undefined ? Number(position) : undefined;
  if (numericPosition !== undefined && !Number.isFinite(numericPosition)) {
    return res.status(400).json({ error: 'position must be a number' });
  }

  try {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        module: {
          include: {
            courseOffering: {
              include: { instructors: { select: { userId: true } } },
            },
          },
        },
      },
    });

    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    const isInstructor = lesson.module.courseOffering.instructors.some(
      (i) => i.userId === authUser.id,
    );
    const unitAdmin = await isUnitAdminForCourse(authUser, lesson.module.courseOffering);
    const isAdmin = authUser.role === 'ADMIN';
    if (!isInstructor && !unitAdmin && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized for this lesson' });
    }

    const updated = await prisma.lesson.update({
      where: { id: lessonId },
      data: {
        title: title ?? undefined,
        contentMd: contentMd ?? undefined,
        position: numericPosition,
      },
    });

    res.json(mapLesson(updated));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Reorder every lesson within a module in one atomic write. Positions are
// reassigned 0..n-1 from the client-supplied ordered id list (issue #1047).
router.put(
  '/modules/:moduleId/lessons/order',
  requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']),
  async (req, res) => {
    const authUser = req.user;
    const moduleId = Number(req.params.moduleId);
    if (!Number.isFinite(moduleId)) {
      return res.status(400).json({ error: 'Invalid module id' });
    }

    const { orderedIds } = req.body || {};
    if (
      !Array.isArray(orderedIds) ||
      orderedIds.length === 0 ||
      !orderedIds.every((id) => Number.isInteger(id))
    ) {
      return res.status(400).json({ error: 'orderedIds must be a non-empty array of integers' });
    }
    if (new Set(orderedIds).size !== orderedIds.length) {
      return res.status(400).json({ error: 'orderedIds must not contain duplicates' });
    }

    try {
      const module = await prisma.module.findUnique({
        where: { id: moduleId },
        include: { courseOffering: { include: { instructors: { select: { userId: true } } } } },
      });
      if (!module) return res.status(404).json({ error: 'Module not found' });

      const isInstructor = module.courseOffering.instructors.some((i) => i.userId === authUser.id);
      const unitAdmin = isUnitAdminForCourse(authUser, module.courseOffering);
      if (!isInstructor && !unitAdmin && authUser.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Not authorized for this module' });
      }

      const existing = await prisma.lesson.findMany({
        where: { moduleId },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((l) => l.id));
      if (
        orderedIds.length !== existingIds.size ||
        !orderedIds.every((id) => existingIds.has(id))
      ) {
        return res
          .status(400)
          .json({ error: 'orderedIds must match the full set of lesson ids for this module' });
      }

      await prisma.$transaction(
        orderedIds.map((id, index) =>
          prisma.lesson.update({ where: { id }, data: { position: index } }),
        ),
      );

      const lessons = await prisma.lesson.findMany({
        where: { moduleId },
        orderBy: { position: 'asc' },
      });
      res.json(lessons.map(mapLesson));
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  },
);

export default router;
