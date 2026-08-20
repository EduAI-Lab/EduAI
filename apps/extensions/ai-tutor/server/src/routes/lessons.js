import express from "express";
import { prisma } from "../config/database.js";
import { requireRole } from "../middleware/auth.js";
import { mapLesson, mapProgressData } from "../utils/mappers.js";
import {
  parsePaginationParams,
  paginated,
  parseSearchParam,
  searchWhere,
  PaginationError,
} from "../utils/pagination.js";
import { moveToPosition, parsePositionBody, ReorderError } from "../services/reorder.js";
import { calculateLessonProgress } from "../services/progressCalculation.js";
import { isCoursePublishedLive } from "../services/courseResolver.js";
import { sendSafeError } from "../utils/safeErrors.js";
import { gateCourseThrough } from "../middleware/liveCoursePrincipal.js";
import {
  LIVE_ENROLLMENT_AUTH_UNAVAILABLE_CODE,
  LIVE_ENROLLMENT_AUTH_UNAVAILABLE_MESSAGE,
} from "../services/enrollmentSync.js";
import {
  authorizeLiveCoursePrincipal,
  isAllowedLiveCourseStaffPrincipal,
  LIVE_COURSE_AUTH_UNAVAILABLE_CODE,
  LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE,
} from "../services/liveCoursePrincipal.js";
import { CreateLessonSchema, UpdateLessonSchema } from "../../../shared/schemas/mutations.js";

const router = express.Router();

async function requireLiveStaffAccess(res, course, user, message) {
  const principal = await authorizeLiveCoursePrincipal(course, user);
  if (principal.state === "unavailable") {
    res.status(503).json({
      error: LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE,
      code: LIVE_COURSE_AUTH_UNAVAILABLE_CODE,
    });
    return false;
  }
  if (!isAllowedLiveCourseStaffPrincipal(principal)) {
    res.status(403).json({ error: message });
    return false;
  }
  return true;
}

router.use(
  "/modules/:moduleId/lessons",
  gateCourseThrough("module", "moduleId", { courseOffering: true }),
);
router.use(
  "/lessons/:lessonId",
  gateCourseThrough("lesson", "lessonId", {
    module: { include: { courseOffering: true } },
  }),
);

async function getExactCourseMembership(course, authUser) {
  const principal = await authorizeLiveCoursePrincipal(course, authUser);
  const liveTa = principal.state === "allowed" && principal.role === "TA";
  return {
    principal,
    isInstructor: principal.state === "allowed" && principal.kind === "INSTRUCTOR",
    isTa: liveTa,
    isStudent: principal.state === "allowed" && principal.role === "STUDENT",
    isUnitAdmin: principal.state === "allowed" && principal.kind === "UNIT_ADMIN",
    isAdmin: principal.state === "allowed" && principal.kind === "ADMIN",
  };
}

router.get("/modules/:moduleId/lessons", async (req, res) => {
  const authUser = req.user;
  if (!authUser) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const moduleId = Number(req.params.moduleId);
  if (!Number.isFinite(moduleId)) {
    return res.status(400).json({ error: "Invalid module id" });
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
      return res.status(404).json({ error: "Module not found" });
    }

    const membership = await getExactCourseMembership(module.courseOffering, authUser);
    const {
      principal,
      isInstructor,
      isTa,
      isStudent,
      isUnitAdmin: unitAdmin,
      isAdmin,
    } = membership;
    if (principal.state === "unavailable") {
      const learner = authUser.role === "STUDENT" || authUser.role === "TA";
      return res.status(503).json({
        error: learner
          ? LIVE_ENROLLMENT_AUTH_UNAVAILABLE_MESSAGE
          : "Course authorization unavailable",
        code: learner ? LIVE_ENROLLMENT_AUTH_UNAVAILABLE_CODE : "COURSE_AUTH_UNAVAILABLE",
      });
    }
    const hasElevatedAccess = isAdmin || isInstructor || isTa || unitAdmin;
    const isMember = hasElevatedAccess || isStudent;

    if (!isMember) {
      return res.status(403).json({ error: "Not authorized for this module" });
    }
    const scope = hasElevatedAccess ? { moduleId } : { moduleId, isPublished: true };

    // #1207: `search` narrows in SQL and is ANDed onto the visibility scope, so
    // a student can never surface an unpublished lesson by searching for it.
    // The same `whereClause` feeds the count and the page, so `total` drives
    // the pager over the filtered set.
    const pageParams = parsePaginationParams(req, { required: false, defaultPageSize: 200 });
    const search = parseSearchParam(req);
    const searchFragment = searchWhere(search, ["title"]);
    const whereClause = searchFragment ? { AND: [scope, searchFragment] } : scope;

    const [total, lessons] = await prisma.$transaction([
      prisma.lesson.count({ where: whereClause }),
      prisma.lesson.findMany({
        where: whereClause,
        orderBy: [{ position: "asc" }, { id: "asc" }],
        skip: pageParams.skip,
        take: pageParams.take,
      }),
    ]);

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
      res.json(paginated(lessonsWithProgress, total, pageParams));
    } else {
      res.json(paginated(lessons.map(mapLesson), total, pageParams));
    }
  } catch (e) {
    if (e instanceof PaginationError) {
      return res.status(e.status).json({ error: e.message, code: e.code });
    }
    sendSafeError(res, e, "Internal server error");
  }
});

router.post(
  "/modules/:moduleId/lessons",
  requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]),
  async (req, res) => {
    const authUser = req.user;
    const moduleId = Number(req.params.moduleId);
    if (!Number.isFinite(moduleId)) {
      return res.status(400).json({ error: "Invalid module id" });
    }

    const parsedBody = CreateLessonSchema.safeParse(req.body);
    if (!parsedBody.success) {
      const field = parsedBody.error.issues[0]?.path[0];
      return res
        .status(400)
        .json({ error: field === "title" ? "title required" : "Invalid payload" });
    }
    const { title, contentMd, position } = parsedBody.data;

    try {
      const module = await prisma.module.findUnique({
        where: { id: moduleId },
        include: { courseOffering: { include: { instructors: { select: { userId: true } } } } },
      });
      if (!module) return res.status(404).json({ error: "Module not found" });

      if (
        !(await requireLiveStaffAccess(
          res,
          module.courseOffering,
          authUser,
          "Not authorized for this module",
        ))
      ) {
        return;
      }

      // Append to the end of the module's lesson list when the client sends no
      // explicit position, rather than defaulting to 0 and pushing the new
      // lesson to the top (issue #1046 / #1047).
      let resolvedPosition;
      if (typeof position === "number") {
        resolvedPosition = position;
      } else {
        const last = await prisma.lesson.findFirst({
          where: { moduleId },
          orderBy: { position: "desc" },
          select: { position: true },
        });
        resolvedPosition = last ? last.position + 1 : 0;
      }

      const lesson = await prisma.lesson.create({
        data: {
          title,
          contentMd: contentMd ?? "",
          position: resolvedPosition,
          moduleId,
        },
      });
      res.status(201).json(mapLesson(lesson));
    } catch (e) {
      sendSafeError(res, e, "Internal server error");
    }
  },
);

router.get("/lessons/:lessonId", async (req, res) => {
  const authUser = req.user;
  if (!authUser) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const lessonId = Number(req.params.lessonId);
  if (!Number.isFinite(lessonId)) {
    return res.status(400).json({ error: "Invalid lesson id" });
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
    if (!lesson) return res.status(404).json({ error: "Lesson not found" });

    const membership = await getExactCourseMembership(lesson.module.courseOffering, authUser);
    const {
      principal,
      isInstructor,
      isTa,
      isStudent,
      isUnitAdmin: unitAdmin,
      isAdmin,
    } = membership;
    if (principal.state === "unavailable") {
      const learner = authUser.role === "STUDENT" || authUser.role === "TA";
      return res.status(503).json({
        error: learner
          ? LIVE_ENROLLMENT_AUTH_UNAVAILABLE_MESSAGE
          : "Course authorization unavailable",
        code: learner ? LIVE_ENROLLMENT_AUTH_UNAVAILABLE_CODE : "COURSE_AUTH_UNAVAILABLE",
      });
    }
    const hasElevatedAccess = isAdmin || isInstructor || isTa || unitAdmin;
    const isMember = hasElevatedAccess || isStudent;

    if (!isMember) {
      return res.status(403).json({ error: "Not authorized for this lesson" });
    }
    if (isStudent && !hasElevatedAccess && !lesson.isPublished) {
      return res.status(403).json({ error: "Lesson is not published" });
    }

    res.json(mapLesson(lesson));
  } catch (e) {
    sendSafeError(res, e, "Internal server error");
  }
});

/**
 * GET /lessons/:lessonId/context — structural position of a lesson in its tree.
 *
 * Returns `{ moduleOrdinal, lessonOrdinal, moduleTotal, lessonTotal,
 * prevLessonId, nextLessonId }`, ordinals 1-based.
 *
 * Why (#1207): the student lesson player derived its "3.2" breadcrumb by
 * fetching the full sibling module and lesson lists and calling `findIndex` on
 * each. That is exactly the read that breaks once a tree exceeds one page — the
 * ordinal silently comes out wrong (or -1) for anything past the page bound.
 * Counting the rows that sort before this one answers the same question in two
 * cheap counts, needs no client-side list at all, and drops two round trips
 * from the player's loader.
 *
 * Visibility mirrors the list endpoints: a student counts only published
 * siblings, so the ordinals they see match the tree they can actually navigate.
 */
router.get("/lessons/:lessonId/context", async (req, res) => {
  const authUser = req.user;
  if (!authUser) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const lessonId = Number(req.params.lessonId);
  if (!Number.isFinite(lessonId)) {
    return res.status(400).json({ error: "Invalid lesson id" });
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
    if (!lesson) return res.status(404).json({ error: "Lesson not found" });

    const { module } = lesson;
    const { courseOffering } = module;
    const membership = await getExactCourseMembership(courseOffering, authUser);
    const {
      principal,
      isInstructor,
      isTa,
      isStudent,
      isUnitAdmin: unitAdmin,
      isAdmin,
    } = membership;
    if (principal.state === "unavailable") {
      const learner = authUser.role === "STUDENT" || authUser.role === "TA";
      return res.status(503).json({
        error: learner
          ? LIVE_ENROLLMENT_AUTH_UNAVAILABLE_MESSAGE
          : "Course authorization unavailable",
        code: learner ? LIVE_ENROLLMENT_AUTH_UNAVAILABLE_CODE : "COURSE_AUTH_UNAVAILABLE",
      });
    }
    const hasElevatedAccess = isAdmin || isInstructor || isTa || unitAdmin;

    if (!hasElevatedAccess && !isStudent) {
      return res.status(403).json({ error: "Not authorized for this lesson" });
    }
    if (isStudent && !hasElevatedAccess && !lesson.isPublished) {
      return res.status(403).json({ error: "Lesson is not published" });
    }

    const publishedOnly = isStudent && !hasElevatedAccess;
    const moduleScope = {
      courseOfferingId: module.courseOfferingId,
      ...(publishedOnly ? { isPublished: true } : {}),
    };
    const lessonScope = {
      moduleId: lesson.moduleId,
      ...(publishedOnly ? { isPublished: true } : {}),
    };

    // "Sorts before me" under the canonical `position asc, id asc` ordering:
    // a strictly-lower position, or an equal position and a lower id. The id
    // tiebreak matters because `position` carries no unique constraint.
    const sortsBefore = (row) => ({
      OR: [{ position: { lt: row.position } }, { position: row.position, id: { lt: row.id } }],
    });
    const sortsAfter = (row) => ({
      OR: [{ position: { gt: row.position } }, { position: row.position, id: { gt: row.id } }],
    });

    const [modulesBefore, moduleTotal, lessonsBefore, lessonTotal, prev, next] = await Promise.all([
      prisma.module.count({ where: { AND: [moduleScope, sortsBefore(module)] } }),
      prisma.module.count({ where: moduleScope }),
      prisma.lesson.count({ where: { AND: [lessonScope, sortsBefore(lesson)] } }),
      prisma.lesson.count({ where: lessonScope }),
      prisma.lesson.findFirst({
        where: { AND: [lessonScope, sortsBefore(lesson)] },
        orderBy: [{ position: "desc" }, { id: "desc" }],
        select: { id: true },
      }),
      prisma.lesson.findFirst({
        where: { AND: [lessonScope, sortsAfter(lesson)] },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: { id: true },
      }),
    ]);

    res.json({
      moduleOrdinal: modulesBefore + 1,
      lessonOrdinal: lessonsBefore + 1,
      moduleTotal,
      lessonTotal,
      prevLessonId: prev?.id ?? null,
      nextLessonId: next?.id ?? null,
    });
  } catch (e) {
    sendSafeError(res, e, "Internal server error");
  }
});

/**
 * PATCH /lessons/:lessonId/position — move one lesson to an absolute ordinal
 * within its module. See the module equivalent for the #1207 rationale;
 * `position` is a 0-based ordinal across the whole module, not a page index.
 */
router.patch(
  "/lessons/:lessonId/position",
  requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]),
  async (req, res) => {
    const authUser = req.user;
    const lessonId = Number(req.params.lessonId);
    if (!Number.isFinite(lessonId)) {
      return res.status(400).json({ error: "Invalid lesson id" });
    }

    try {
      const targetPosition = parsePositionBody(req.body?.position);

      const lesson = await prisma.lesson.findUnique({
        where: { id: lessonId },
        include: {
          module: {
            include: {
              courseOffering: { include: { instructors: { select: { userId: true } } } },
            },
          },
        },
      });
      if (!lesson) return res.status(404).json({ error: "Lesson not found" });

      if (
        !(await requireLiveStaffAccess(
          res,
          lesson.module.courseOffering,
          authUser,
          "Not authorized for this module",
        ))
      ) {
        return;
      }

      const { position, total } = await moveToPosition({
        model: "lesson",
        id: lessonId,
        scopeWhere: { moduleId: lesson.moduleId },
        targetPosition,
      });

      const updated = await prisma.lesson.findUnique({ where: { id: lessonId } });
      res.json({ lesson: mapLesson(updated), position, total });
    } catch (e) {
      if (e instanceof ReorderError) {
        return res.status(e.status).json({ error: e.message, code: e.code });
      }
      sendSafeError(res, e, "Internal server error");
    }
  },
);

// Publish a lesson (requires parent module AND course to be published)
router.patch(
  "/lessons/:lessonId/publish",
  requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]),
  async (req, res) => {
    const instructor = req.user;
    const lessonId = Number(req.params.lessonId);
    if (!Number.isFinite(lessonId)) {
      return res.status(400).json({ error: "Invalid lesson id" });
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
        return res.status(404).json({ error: "Lesson not found" });
      }

      if (
        !(await requireLiveStaffAccess(
          res,
          lesson.module.courseOffering,
          instructor,
          "Not authorized for this lesson",
        ))
      ) {
        return;
      }

      // Validate parent course is published — `isPublished` is Core-owned
      // (#1072 step 4), resolved live rather than read off the local row.
      if (!(await isCoursePublishedLive(lesson.module.courseOffering.coreOfferingId))) {
        return res.status(400).json({
          error: "Cannot publish lesson: parent course is not published",
        });
      }

      // Validate parent module is published
      if (!lesson.module.isPublished) {
        return res.status(400).json({
          error: "Cannot publish lesson: parent module is not published",
        });
      }

      const updated = await prisma.lesson.update({
        where: { id: lessonId },
        data: { isPublished: true },
      });

      res.json(mapLesson(updated));
    } catch (e) {
      sendSafeError(res, e, "Internal server error");
    }
  },
);

// Unpublish a lesson (no cascading, lessons have no children)
router.patch(
  "/lessons/:lessonId/unpublish",
  requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]),
  async (req, res) => {
    const instructor = req.user;
    const lessonId = Number(req.params.lessonId);
    if (!Number.isFinite(lessonId)) {
      return res.status(400).json({ error: "Invalid lesson id" });
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
        return res.status(404).json({ error: "Lesson not found" });
      }

      if (
        !(await requireLiveStaffAccess(
          res,
          lesson.module.courseOffering,
          instructor,
          "Not authorized for this lesson",
        ))
      ) {
        return;
      }

      const updated = await prisma.lesson.update({
        where: { id: lessonId },
        data: { isPublished: false },
      });

      res.json(mapLesson(updated));
    } catch (e) {
      sendSafeError(res, e, "Internal server error");
    }
  },
);

router.delete(
  "/lessons/:lessonId",
  requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]),
  async (req, res) => {
    const authUser = req.user;
    const lessonId = Number(req.params.lessonId);
    if (!Number.isFinite(lessonId)) {
      return res.status(400).json({ error: "Invalid lesson id" });
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
        return res.status(404).json({ error: "Lesson not found" });
      }

      if (
        !(await requireLiveStaffAccess(
          res,
          lesson.module.courseOffering,
          authUser,
          "Not authorized for this lesson",
        ))
      ) {
        return;
      }

      await prisma.lesson.delete({ where: { id: lessonId } });
      res.status(204).end();
    } catch (e) {
      sendSafeError(res, e, "Internal server error");
    }
  },
);

router.patch(
  "/lessons/:lessonId",
  requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]),
  async (req, res) => {
    const authUser = req.user;
    const lessonId = Number(req.params.lessonId);
    if (!Number.isFinite(lessonId)) {
      return res.status(400).json({ error: "Invalid lesson id" });
    }

    const parsedBody = UpdateLessonSchema.safeParse(req.body);
    if (!parsedBody.success) {
      const field = parsedBody.error.issues[0]?.path[0];
      const error =
        field === "title"
          ? "title cannot be empty"
          : field === "position"
            ? "position must be a number"
            : "Nothing to update";
      return res.status(400).json({ error });
    }
    const { title, contentMd, position } = parsedBody.data;

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
        return res.status(404).json({ error: "Lesson not found" });
      }

      if (
        !(await requireLiveStaffAccess(
          res,
          lesson.module.courseOffering,
          authUser,
          "Not authorized for this lesson",
        ))
      ) {
        return;
      }

      const updated = await prisma.lesson.update({
        where: { id: lessonId },
        data: {
          title: title ?? undefined,
          contentMd: contentMd ?? undefined,
          position,
        },
      });

      res.json(mapLesson(updated));
    } catch (e) {
      sendSafeError(res, e, "Internal server error");
    }
  },
);

// Reorder every lesson within a module in one atomic write. Positions are
// reassigned 0..n-1 from the client-supplied ordered id list (issue #1047).
router.put(
  "/modules/:moduleId/lessons/order",
  requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]),
  async (req, res) => {
    const authUser = req.user;
    const moduleId = Number(req.params.moduleId);
    if (!Number.isFinite(moduleId)) {
      return res.status(400).json({ error: "Invalid module id" });
    }

    const { orderedIds } = req.body || {};
    if (
      !Array.isArray(orderedIds) ||
      orderedIds.length === 0 ||
      !orderedIds.every((id) => Number.isInteger(id))
    ) {
      return res.status(400).json({ error: "orderedIds must be a non-empty array of integers" });
    }
    if (new Set(orderedIds).size !== orderedIds.length) {
      return res.status(400).json({ error: "orderedIds must not contain duplicates" });
    }

    try {
      const module = await prisma.module.findUnique({
        where: { id: moduleId },
        include: { courseOffering: { include: { instructors: { select: { userId: true } } } } },
      });
      if (!module) return res.status(404).json({ error: "Module not found" });

      if (
        !(await requireLiveStaffAccess(
          res,
          module.courseOffering,
          authUser,
          "Not authorized for this module",
        ))
      ) {
        return;
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
          .json({ error: "orderedIds must match the full set of lesson ids for this module" });
      }

      await prisma.$transaction(
        orderedIds.map((id, index) =>
          prisma.lesson.update({ where: { id }, data: { position: index } }),
        ),
      );

      const lessons = await prisma.lesson.findMany({
        where: { moduleId },
        orderBy: { position: "asc" },
      });
      res.json(lessons.map(mapLesson));
    } catch (e) {
      sendSafeError(res, e, "Internal server error");
    }
  },
);

export default router;
