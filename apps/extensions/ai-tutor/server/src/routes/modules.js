import express from 'express';
import { prisma } from '../config/database.js';
import { requireRole, isUnitAdminForCourse } from '../middleware/auth.js';
import { mapModule, mapProgressData } from '../utils/mappers.js';
import {
  parsePaginationParams,
  paginated,
  parseSearchParam,
  searchWhere,
  PaginationError,
} from '../utils/pagination.js';
import { moveToPosition, parsePositionBody, ReorderError } from '../services/reorder.js';
import { calculateModuleProgress } from '../services/progressCalculation.js';
import { isCoursePublishedLive } from '../services/courseResolver.js';

const router = express.Router();

async function getCourseMembership(courseId, authUser) {
  const course = await prisma.courseOffering.findUnique({
    where: { id: courseId },
    include: {
      instructors: { select: { userId: true } },
      enrollments: { select: { userId: true, role: true } },
    },
  });

  if (!course) {
    return {
      course: null,
      isInstructor: false,
      isTa: false,
      isStudent: false,
      isUnitAdmin: false,
      isAdmin: false,
    };
  }

  const isInstructor = course.instructors.some((i) => i.userId === authUser.id);
  const enrollment = course.enrollments.find((e) => e.userId === authUser.id);
  return {
    course,
    isInstructor,
    isTa: enrollment?.role === 'TA',
    isStudent: enrollment?.role === 'STUDENT',
    isUnitAdmin: await isUnitAdminForCourse(authUser, course),
    isAdmin: authUser.role === 'ADMIN',
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
    const { course, isInstructor, isTa, isStudent, isUnitAdmin, isAdmin } = await getCourseMembership(courseId, authUser);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const hasElevatedAccess = isAdmin || isInstructor || isTa || isUnitAdmin;
    const isMember = hasElevatedAccess || isStudent;

    if (!isMember) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    const scope = hasElevatedAccess
      ? { courseOfferingId: courseId }
      : { courseOfferingId: courseId, isPublished: true };

    // #1207: `search` narrows in SQL and is ANDed onto the visibility scope, so
    // a student can never surface an unpublished module by searching for it.
    // The same `whereClause` feeds the count and the page, so `total` drives
    // the pager over the filtered set.
    const pageParams = parsePaginationParams(req, { required: false, defaultPageSize: 200 });
    const search = parseSearchParam(req);
    const searchFragment = searchWhere(search, ['title', 'description']);
    const whereClause = searchFragment ? { AND: [scope, searchFragment] } : scope;

    const [total, modules] = await prisma.$transaction([
      prisma.module.count({ where: whereClause }),
      prisma.module.findMany({
        where: whereClause,
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        skip: pageParams.skip,
        take: pageParams.take,
      }),
    ]);

    // For students, add progress to each module
    if (isStudent && !hasElevatedAccess) {
      const modulesWithProgress = await Promise.all(
        modules.map(async (module) => {
          const progress = await calculateModuleProgress(module.id, authUser.id);
          return {
            ...mapModule(module),
            progress: mapProgressData(progress),
          };
        }),
      );
      res.json(paginated(modulesWithProgress, total, pageParams));
    } else {
      res.json(paginated(modules.map(mapModule), total, pageParams));
    }
  } catch (e) {
    if (e instanceof PaginationError) {
      return res.status(e.status).json({ error: e.message, code: e.code });
    }
    res.status(500).json({ error: String(e) });
  }
});

router.post('/courses/:courseId/modules', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  const authUser = req.user;
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: 'Invalid course id' });
  }

  const { title, description, position } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });

  try {
    const course = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: { instructors: { select: { userId: true } } },
    });
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const isInstructor = course.instructors.some((i) => i.userId === authUser.id);
    const unitAdmin = await isUnitAdminForCourse(authUser, course);
    if (!isInstructor && !unitAdmin && authUser.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    // When the client does not supply an explicit position, append the new
    // module to the end of the list rather than defaulting to 0, which would
    // push it to the top and shift every existing module down (issue #1046).
    let resolvedPosition;
    if (typeof position === 'number') {
      resolvedPosition = position;
    } else {
      const last = await prisma.module.findFirst({
        where: { courseOfferingId: courseId },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      resolvedPosition = last ? last.position + 1 : 0;
    }

    const module = await prisma.module.create({
      data: {
        title,
        description,
        position: resolvedPosition,
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
            enrollments: { select: { userId: true, role: true } },
          },
        },
      },
    });
    if (!module) return res.status(404).json({ error: 'Module not found' });

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
    if (isStudent && !hasElevatedAccess && !module.isPublished) {
      return res.status(403).json({ error: 'Module is not published' });
    }

    res.json({ ...mapModule(module), courseOfferingId: module.courseOfferingId });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Publish a module (requires parent course to be published)
router.patch('/modules/:moduleId/publish', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
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
    const unitAdmin = await isUnitAdminForCourse(instructor, module.courseOffering);
    if (!isInstructor && !unitAdmin && instructor.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Not authorized for this module' });
    }

    // Validate parent course is published — `isPublished` is Core-owned
    // (#1072 step 4), resolved live rather than read off the local row.
    if (!(await isCoursePublishedLive(module.courseOffering.coreOfferingId))) {
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
router.patch('/modules/:moduleId/unpublish', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
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
    const unitAdmin = await isUnitAdminForCourse(instructor, module.courseOffering);
    if (!isInstructor && !unitAdmin && instructor.role !== 'ADMIN') {
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

router.delete('/modules/:moduleId', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  const authUser = req.user;
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

    const isInstructor = module.courseOffering.instructors.some((i) => i.userId === authUser.id);
    const unitAdmin = await isUnitAdminForCourse(authUser, module.courseOffering);
    const isAdmin = authUser.role === 'ADMIN';
    if (!isInstructor && !unitAdmin && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized for this module' });
    }

    await prisma.module.delete({ where: { id: moduleId } });
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Update a module's editable fields (title / description / position)
router.patch('/modules/:moduleId', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  const authUser = req.user;
  const moduleId = Number(req.params.moduleId);
  if (!Number.isFinite(moduleId)) {
    return res.status(400).json({ error: 'Invalid module id' });
  }

  const { title, description, position } = req.body || {};
  if (title === undefined && description === undefined && position === undefined) {
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

    const isInstructor = module.courseOffering.instructors.some((i) => i.userId === authUser.id);
    const unitAdmin = await isUnitAdminForCourse(authUser, module.courseOffering);
    const isAdmin = authUser.role === 'ADMIN';
    if (!isInstructor && !unitAdmin && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized for this module' });
    }

    const updated = await prisma.module.update({
      where: { id: moduleId },
      data: {
        title: title ?? undefined,
        description: description === undefined ? undefined : description,
        position: numericPosition,
      },
    });

    res.json(mapModule(updated));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * PATCH /modules/:moduleId/position — move one module to an absolute ordinal.
 *
 * Auth: same as the bulk reorder below (course instructor / unit-admin / admin).
 *
 * Why alongside the bulk endpoint (#1207): the module grid is now paged, so a
 * drag on page 3 no longer has the full ordered id set to send. `position` is a
 * 0-based ordinal across the WHOLE course, which the client derives as
 * `(page - 1) * pageSize + dropIndex`, and which the "Move to position…" menu
 * item sends directly for a cross-page move.
 */
router.patch(
  '/modules/:moduleId/position',
  requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']),
  async (req, res) => {
    const authUser = req.user;
    const moduleId = Number(req.params.moduleId);
    if (!Number.isFinite(moduleId)) {
      return res.status(400).json({ error: 'Invalid module id' });
    }

    try {
      const targetPosition = parsePositionBody(req.body?.position);

      const module = await prisma.module.findUnique({
        where: { id: moduleId },
        include: {
          courseOffering: { include: { instructors: { select: { userId: true } } } },
        },
      });
      if (!module) return res.status(404).json({ error: 'Module not found' });

      const isInstructor = module.courseOffering.instructors.some(
        (i) => i.userId === authUser.id,
      );
      const unitAdmin = await isUnitAdminForCourse(authUser, module.courseOffering);
      if (!isInstructor && !unitAdmin && authUser.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Not authorized for this course' });
      }

      const { position, total } = await moveToPosition({
        model: 'module',
        id: moduleId,
        scopeWhere: { courseOfferingId: module.courseOfferingId },
        targetPosition,
      });

      const updated = await prisma.module.findUnique({ where: { id: moduleId } });
      res.json({ module: mapModule(updated), position, total });
    } catch (e) {
      if (e instanceof ReorderError) {
        return res.status(e.status).json({ error: e.message, code: e.code });
      }
      res.status(500).json({ error: String(e) });
    }
  },
);

// Reorder every module in a course in one atomic write. The client sends the
// full ordered list of module ids; positions are reassigned 0..n-1 by index.
// Bulk-and-atomic (rather than N single-field PATCHes) avoids transient
// duplicate positions and partial reorders on failure (issue #1047).
router.put(
  '/courses/:courseId/modules/order',
  requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']),
  async (req, res) => {
    const authUser = req.user;
    const courseId = Number(req.params.courseId);
    if (!Number.isFinite(courseId)) {
      return res.status(400).json({ error: 'Invalid course id' });
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
      const course = await prisma.courseOffering.findUnique({
        where: { id: courseId },
        include: { instructors: { select: { userId: true } } },
      });
      if (!course) return res.status(404).json({ error: 'Course not found' });

      const isInstructor = course.instructors.some((i) => i.userId === authUser.id);
      // `isUnitAdminForCourse` is async — without the await this resolved to a
      // (always truthy) Promise, so the guard below never denied anyone.
      const unitAdmin = await isUnitAdminForCourse(authUser, course);
      if (!isInstructor && !unitAdmin && authUser.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Not authorized for this course' });
      }

      const existing = await prisma.module.findMany({
        where: { courseOfferingId: courseId },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((m) => m.id));
      // The provided ids must be exactly the course's modules — no more, no less.
      if (
        orderedIds.length !== existingIds.size ||
        !orderedIds.every((id) => existingIds.has(id))
      ) {
        return res
          .status(400)
          .json({ error: 'orderedIds must match the full set of module ids for this course' });
      }

      await prisma.$transaction(
        orderedIds.map((id, index) =>
          prisma.module.update({ where: { id }, data: { position: index } }),
        ),
      );

      const modules = await prisma.module.findMany({
        where: { courseOfferingId: courseId },
        orderBy: { position: 'asc' },
      });
      res.json(modules.map(mapModule));
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  },
);

export default router;
