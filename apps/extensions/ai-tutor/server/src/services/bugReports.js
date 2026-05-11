/**
 * @file Validate, authorize, and persist user-submitted bug reports.
 *
 * Responsibility: Normalize bug-report payloads, enforce context hierarchy and
 * role-based access rules, and expose admin read/update helpers over the
 * resulting records.
 * Callers: Bug-report routes for student/instructor submission plus admin
 * review/status-management endpoints.
 * Gotchas:
 *   - Context ids must describe a real course -> module -> lesson -> activity
 *     chain. Partial or mismatched ids are rejected so reports cannot be filed
 *     against unrelated content.
 *   - RBAC is content-aware: students must be enrolled in the course and
 *     professors must instruct it before a contextual report is accepted.
 *   - `BugReportError` is the service-level error contract; route handlers rely
 *     on its `status` field to map validation/auth failures cleanly.
 *   - Anonymous mode hides identity only in downstream admin mapping; the raw
 *     row still belongs to the submitting user so authorization/audit remain intact.
 * Related: `docs/ARCHITECTURE.md`, `server/src/routes/bugReports.js`,
 *   `server/src/utils/bugReportMappers.js`.
 */

import { prisma } from '../config/database.js';

export const BUG_REPORT_STATUSES = ['unhandled', 'in progress', 'resolved'];
const BUG_REPORT_STATUS_SET = new Set(BUG_REPORT_STATUSES);

/**
 * Error shape consumed by route handlers to produce clean bug-report HTTP responses.
 *
 * Why: Validation and authorization failures are expected outcomes here, so the
 * service throws a typed status-bearing error instead of forcing each route to
 * reverse-engineer generic exceptions.
 */
export class BugReportError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function toOptionalInt(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new BugReportError(400, `${fieldName} must be an integer`);
  }
  return parsed;
}

function normalizeDescription(value) {
  if (typeof value !== 'string') {
    throw new BugReportError(400, 'description must be a string');
  }
  const description = value.trim();
  if (description.length < 10) {
    throw new BugReportError(400, 'description must be at least 10 characters');
  }
  if (description.length > 2000) {
    throw new BugReportError(400, 'description must be at most 2000 characters');
  }
  return description;
}

function normalizeOptionalString(value, fieldName) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new BugReportError(400, `${fieldName} must be a string`);
  }
  return value;
}

function normalizeOptionalBoolean(value, fieldName, defaultValue = false) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value !== 'boolean') {
    throw new BugReportError(400, `${fieldName} must be a boolean`);
  }
  return value;
}

function normalizeContext(context) {
  const data = context && typeof context === 'object' ? context : {};

  const normalized = {
    courseOfferingId: toOptionalInt(data.courseOfferingId, 'context.courseOfferingId'),
    moduleId: toOptionalInt(data.moduleId, 'context.moduleId'),
    lessonId: toOptionalInt(data.lessonId, 'context.lessonId'),
    activityId: toOptionalInt(data.activityId, 'context.activityId'),
  };

  if (normalized.activityId !== null && normalized.lessonId === null) {
    throw new BugReportError(
      400,
      'context.lessonId is required when context.activityId is present',
    );
  }
  if (normalized.lessonId !== null && normalized.moduleId === null) {
    throw new BugReportError(400, 'context.moduleId is required when context.lessonId is present');
  }
  if (normalized.moduleId !== null && normalized.courseOfferingId === null) {
    throw new BugReportError(
      400,
      'context.courseOfferingId is required when context.moduleId is present',
    );
  }

  return normalized;
}

function ensureCourseAuthorization(user, course) {
  const isStudent = user.role === 'STUDENT';
  const isProfessor = user.role === 'PROFESSOR';
  if (!isStudent && !isProfessor) {
    throw new BugReportError(403, 'Only STUDENT and PROFESSOR users can submit bug reports');
  }

  if (isStudent) {
    const enrolled = course.enrollments.some((row) => row.userId === user.id);
    if (!enrolled) {
      throw new BugReportError(403, 'Not authorized for the provided bug report context');
    }
    return;
  }

  const instructs = course.instructors.some((row) => row.userId === user.id);
  if (!instructs) {
    throw new BugReportError(403, 'Not authorized for the provided bug report context');
  }
}

async function validateContextAndAccess(user, context) {
  const hasContext =
    context.courseOfferingId !== null ||
    context.moduleId !== null ||
    context.lessonId !== null ||
    context.activityId !== null;

  if (!hasContext) {
    return context;
  }

  if (context.activityId !== null) {
    const activity = await prisma.activity.findUnique({
      where: { id: context.activityId },
      include: {
        lesson: {
          include: {
            module: {
              include: {
                courseOffering: {
                  include: {
                    instructors: { select: { userId: true } },
                    enrollments: { select: { userId: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!activity) {
      throw new BugReportError(400, 'context.activityId does not exist');
    }

    const dbLessonId = activity.lessonId;
    const dbModuleId = activity.lesson.moduleId;
    const dbCourseOfferingId = activity.lesson.module.courseOfferingId;
    // The deepest provided context must agree with every parent id so reports
    // cannot be attached to a valid activity under the wrong course/module.
    if (
      dbLessonId !== context.lessonId ||
      dbModuleId !== context.moduleId ||
      dbCourseOfferingId !== context.courseOfferingId
    ) {
      throw new BugReportError(400, 'Provided context IDs are not internally consistent');
    }

    ensureCourseAuthorization(user, activity.lesson.module.courseOffering);
    return context;
  }

  if (context.lessonId !== null) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: context.lessonId },
      include: {
        module: {
          include: {
            courseOffering: {
              include: {
                instructors: { select: { userId: true } },
                enrollments: { select: { userId: true } },
              },
            },
          },
        },
      },
    });

    if (!lesson) {
      throw new BugReportError(400, 'context.lessonId does not exist');
    }

    const dbModuleId = lesson.moduleId;
    const dbCourseOfferingId = lesson.module.courseOfferingId;
    if (dbModuleId !== context.moduleId || dbCourseOfferingId !== context.courseOfferingId) {
      throw new BugReportError(400, 'Provided context IDs are not internally consistent');
    }

    ensureCourseAuthorization(user, lesson.module.courseOffering);
    return context;
  }

  if (context.moduleId !== null) {
    const module = await prisma.module.findUnique({
      where: { id: context.moduleId },
      include: {
        courseOffering: {
          include: {
            instructors: { select: { userId: true } },
            enrollments: { select: { userId: true } },
          },
        },
      },
    });

    if (!module) {
      throw new BugReportError(400, 'context.moduleId does not exist');
    }

    if (module.courseOfferingId !== context.courseOfferingId) {
      throw new BugReportError(400, 'Provided context IDs are not internally consistent');
    }

    ensureCourseAuthorization(user, module.courseOffering);
    return context;
  }

  const course = await prisma.courseOffering.findUnique({
    where: { id: context.courseOfferingId },
    include: {
      instructors: { select: { userId: true } },
      enrollments: { select: { userId: true } },
    },
  });

  if (!course) {
    throw new BugReportError(400, 'context.courseOfferingId does not exist');
  }

  ensureCourseAuthorization(user, course);
  return context;
}

/**
 * Persist a user-submitted bug report after validating content, hierarchy, and access.
 *
 * @throws BugReportError - When the payload is malformed or the user is not
 * authorized for the supplied course context.
 *
 * Why: The bug-report dialog can be opened from many surfaces, so the service
 * re-derives trust from ids in the payload instead of assuming the frontend's
 * contextual metadata is correct.
 */
export async function createBugReport(user, payload) {
  const description = normalizeDescription(payload?.description);
  const consoleLogs = normalizeOptionalString(payload?.consoleLogs, 'consoleLogs');
  const networkLogs = normalizeOptionalString(payload?.networkLogs, 'networkLogs');
  const screenshot = normalizeOptionalString(payload?.screenshot, 'screenshot');
  const pageUrl = normalizeOptionalString(payload?.pageUrl, 'pageUrl');
  const userAgent = normalizeOptionalString(payload?.userAgent, 'userAgent');
  const isAnonymous = normalizeOptionalBoolean(payload?.isAnonymous, 'isAnonymous', false);

  const context = normalizeContext(payload?.context);
  const validatedContext = await validateContextAndAccess(user, context);

  return prisma.bugReport.create({
    data: {
      description,
      consoleLogs,
      networkLogs,
      screenshot,
      pageUrl,
      userAgent,
      isAnonymous,
      userId: user.id,
      courseOfferingId: validatedContext.courseOfferingId,
      moduleId: validatedContext.moduleId,
      lessonId: validatedContext.lessonId,
      activityId: validatedContext.activityId,
    },
  });
}

/**
 * Load the full bug-report list for the admin review console.
 *
 * Why: Admin triage needs the related course/module/lesson/activity labels in
 * one query so the UI can sort and inspect reports without N+1 follow-up calls.
 */
export async function listAdminBugReports() {
  return prisma.bugReport.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: {
      user: {
        select: { id: true, name: true, email: true, role: true },
      },
      courseOffering: {
        select: { id: true, title: true },
      },
      module: {
        select: { id: true, title: true },
      },
      lesson: {
        select: { id: true, title: true },
      },
      activity: {
        select: { id: true, title: true, config: true },
      },
    },
  });
}

/**
 * Validate a status transition against the fixed admin-visible workflow states.
 *
 * Why: Keeping the enum check in one place prevents route/UI drift when the
 * admin table patches bug reports.
 */
export function validateBugReportStatus(status) {
  if (typeof status !== 'string' || !BUG_REPORT_STATUS_SET.has(status)) {
    throw new BugReportError(400, `status must be one of: ${BUG_REPORT_STATUSES.join(', ')}`);
  }
  return status;
}

/**
 * Update a bug report's triage status for the admin console.
 *
 * @throws BugReportError - When the id is invalid, the status is unsupported,
 * or the target report does not exist.
 *
 * Why: Status changes are the only mutable admin action on bug reports, so this
 * helper preserves the same include shape as listing to let the UI refresh from
 * the PATCH response directly.
 */
export async function updateBugReportStatus(bugReportId, nextStatus) {
  if (typeof bugReportId !== 'string' || bugReportId.trim().length === 0) {
    throw new BugReportError(400, 'Invalid bug report id');
  }

  const status = validateBugReportStatus(nextStatus);

  try {
    return await prisma.bugReport.update({
      where: { id: bugReportId },
      data: { status },
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true },
        },
        courseOffering: {
          select: { id: true, title: true },
        },
        module: {
          select: { id: true, title: true },
        },
        lesson: {
          select: { id: true, title: true },
        },
        activity: {
          select: { id: true, title: true, config: true },
        },
      },
    });
  } catch (error) {
    if (error?.code === 'P2025') {
      throw new BugReportError(404, 'Bug report not found');
    }
    throw error;
  }
}
