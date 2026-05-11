import express from 'express';
import { prisma } from '../config/database.js';
import { requireRole } from '../middleware/auth.js';
import { mapModule, mapProgressData } from '../utils/mappers.js';
import { calculateModuleProgress } from '../services/progressCalculation.js';

const router = express.Router();

async function getCourseMembership(courseId, userId) {
  const course = await prisma.courseOffering.findUnique({
    where: { id: courseId },
    include: {
      instructors: { select: { userId: true } },
      enrollments: { select: { userId: true } },
    },
  });

  if (!course) {
    return { course: null, isInstructor: false, isStudent: false };
  }

  return {
    course,
    isInstructor: course.instructors.some((assignment) => assignment.userId === userId),
    isStudent: course.enrollments.some((enrollment) => enrollment.userId === userId),
  };
}

router.get('/courses/:courseId/modules', async (req, res) => {
  const authUser = req.user;
  const courseId = Number(req.params.courseId);
  if (!authUser) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: 'Invalid course id' });
  }

  try {
    const { course, isInstructor, isStudent } = await getCourseMembership(courseId, authUser.id);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    if (authUser.role === 'PROFESSOR' && !isInstructor) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }
    if (authUser.role === 'STUDENT' && !isStudent) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }
    if (authUser.role !== 'PROFESSOR' && authUser.role !== 'STUDENT') {
      return res.status(403).json({ error: 'Role is not supported in AI Tutor' });
    }

    const whereClause =
      authUser.role === 'STUDENT'
        ? { courseOfferingId: courseId, isPublished: true }
        : { courseOfferingId: courseId };

    const modules = await prisma.module.findMany({
      where: whereClause,
      orderBy: { position: 'asc' },
    });

    // For students, add progress to each module
    if (authUser && authUser.role === 'STUDENT') {
      const modulesWithProgress = await Promise.all(
        modules.map(async (module) => {
          const progress = await calculateModuleProgress(module.id, authUser.id);
          return {
            ...mapModule(module),
            progress: mapProgressData(progress),
          };
        }),
      );
      res.json(modulesWithProgress);
    } else {
      res.json(modules.map(mapModule));
    }
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post('/courses/:courseId/modules', requireRole('PROFESSOR'), async (req, res) => {
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: 'Invalid course id' });
  }

  const { title, description, position } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });

  try {
    const module = await prisma.module.create({
      data: {
        title,
        description,
        position: typeof position === 'number' ? position : 0,
        courseOfferingId: courseId,
      },
    });
    res.status(201).json(mapModule(module));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get('/modules/:moduleId', async (req, res) => {
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
            enrollments: { select: { userId: true } },
          },
        },
      },
    });
    if (!module) return res.status(404).json({ error: 'Module not found' });
    const isInstructor = module.courseOffering.instructors.some(
      (assignment) => assignment.userId === authUser.id,
    );
    const isStudent = module.courseOffering.enrollments.some(
      (enrollment) => enrollment.userId === authUser.id,
    );

    if (authUser.role === 'PROFESSOR' && !isInstructor) {
      return res.status(403).json({ error: 'Not authorized for this module' });
    }
    if (authUser.role === 'STUDENT') {
      if (!isStudent) {
        return res.status(403).json({ error: 'Not authorized for this module' });
      }
      if (!module.isPublished) {
        return res.status(403).json({ error: 'Module is not published' });
      }
    }
    if (authUser.role !== 'PROFESSOR' && authUser.role !== 'STUDENT') {
      return res.status(403).json({ error: 'Role is not supported in AI Tutor' });
    }

    res.json({ ...mapModule(module), courseOfferingId: module.courseOfferingId });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Publish a module (requires parent course to be published)
router.patch('/modules/:moduleId/publish', requireRole('PROFESSOR'), async (req, res) => {
  const instructor = req.user;
  const moduleId = Number(req.params.moduleId);
  if (!Number.isFinite(moduleId)) {
    return res.status(400).json({ error: 'Invalid module id' });
  }

  try {
    const module = await prisma.module.findUnique({
      where: { id: moduleId },
      include: {
        courseOffering: {
          include: { instructors: { select: { userId: true } } },
        },
      },
    });

    if (!module) {
      return res.status(404).json({ error: 'Module not found' });
    }

    const isInstructor = module.courseOffering.instructors.some((i) => i.userId === instructor.id);
    if (!isInstructor) {
      return res.status(403).json({ error: 'Not authorized for this module' });
    }

    // Validate parent course is published
    if (!module.courseOffering.isPublished) {
      return res
        .status(400)
        .json({ error: 'Cannot publish module: parent course is not published' });
    }

    const updated = await prisma.module.update({
      where: { id: moduleId },
      data: { isPublished: true },
    });

    res.json(mapModule(updated));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Unpublish a module (cascades to all lessons)
router.patch('/modules/:moduleId/unpublish', requireRole('PROFESSOR'), async (req, res) => {
  const instructor = req.user;
  const moduleId = Number(req.params.moduleId);
  if (!Number.isFinite(moduleId)) {
    return res.status(400).json({ error: 'Invalid module id' });
  }

  try {
    const module = await prisma.module.findUnique({
      where: { id: moduleId },
      include: {
        courseOffering: {
          include: { instructors: { select: { userId: true } } },
        },
      },
    });

    if (!module) {
      return res.status(404).json({ error: 'Module not found' });
    }

    const isInstructor = module.courseOffering.instructors.some((i) => i.userId === instructor.id);
    if (!isInstructor) {
      return res.status(403).json({ error: 'Not authorized for this module' });
    }

    // Unpublish module and cascade to all lessons
    await prisma.$transaction(async (tx) => {
      await tx.module.update({
        where: { id: moduleId },
        data: { isPublished: false },
      });

      await tx.lesson.updateMany({
        where: { moduleId },
        data: { isPublished: false },
      });
    });

    const updated = await prisma.module.findUnique({
      where: { id: moduleId },
    });

    res.json(mapModule(updated));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
