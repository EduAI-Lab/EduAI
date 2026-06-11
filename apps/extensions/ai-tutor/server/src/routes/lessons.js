import express from 'express';
import { prisma } from '../config/database.js';
import { requireRole, isUnitAdminForCourse } from '../middleware/auth.js';
import { mapLesson, mapProgressData } from '../utils/mappers.js';
import { calculateLessonProgress } from '../services/progressCalculation.js';

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
    const unitAdmin = isUnitAdminForCourse(authUser, module.courseOffering);
    const hasElevatedAccess = isInstructor || isTa || unitAdmin;
    const isMember = hasElevatedAccess || isStudent;

    if (authUser.role === 'INSTRUCTOR' && !isInstructor) {
      return res.status(403).json({ error: 'Not authorized for this module' });
    }
    if (authUser.role === 'UNIT_ADMIN' && !unitAdmin) {
      return res.status(403).json({ error: 'Not authorized for this module' });
    }
    if (!isMember) {
      return res.status(403).json({ error: 'Not authorized for this module' });
    }
    if (!['INSTRUCTOR', 'TA', 'STUDENT', 'UNIT_ADMIN'].includes(authUser.role)) {
      return res.status(403).json({ error: 'Role is not supported in AI Tutor' });
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
    const unitAdmin = isUnitAdminForCourse(authUser, module.courseOffering);
    if (!isInstructor && !unitAdmin && authUser.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Not authorized for this module' });
    }

    const lesson = await prisma.lesson.create({
      data: {
        title,
        contentMd: contentMd ?? '',
        position: typeof position === 'number' ? position : 0,
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
    const unitAdmin = isUnitAdminForCourse(authUser, lesson.module.courseOffering);
    const hasElevatedAccess = isInstructor || isTa || unitAdmin;
    const isMember = hasElevatedAccess || isStudent;

    if (authUser.role === 'INSTRUCTOR' && !isInstructor) {
      return res.status(403).json({ error: 'Not authorized for this lesson' });
    }
    if (authUser.role === 'UNIT_ADMIN' && !unitAdmin) {
      return res.status(403).json({ error: 'Not authorized for this lesson' });
    }
    if (!isMember) {
      return res.status(403).json({ error: 'Not authorized for this lesson' });
    }
    if (!['INSTRUCTOR', 'TA', 'STUDENT', 'UNIT_ADMIN'].includes(authUser.role)) {
      return res.status(403).json({ error: 'Role is not supported in AI Tutor' });
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
    const unitAdmin = isUnitAdminForCourse(instructor, lesson.module.courseOffering);
    if (!isInstructor && !unitAdmin && instructor.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Not authorized for this lesson' });
    }

    // Validate parent course is published
    if (!lesson.module.courseOffering.isPublished) {
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
    const unitAdmin = isUnitAdminForCourse(instructor, lesson.module.courseOffering);
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
    const unitAdmin = isUnitAdminForCourse(authUser, lesson.module.courseOffering);
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
    const unitAdmin = isUnitAdminForCourse(authUser, lesson.module.courseOffering);
    const isAdmin = authUser.role === 'ADMIN';
    if (!isInstructor && !unitAdmin && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized for this lesson' });
    }

    const updated = await prisma.lesson.update({
      where: { id: lessonId },
      data: {
        title: title ?? undefined,
        contentMd: contentMd ?? undefined,
        position: typeof position === 'number' ? position : undefined,
      },
    });

    res.json(mapLesson(updated));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
