import type { Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { buildCourseListFilter } from "~/lib/auth/course-access.server";
import { listCoursesForUser } from "~/lib/courses/server";
import { listChats, type ChatHistoryItem } from "~/lib/chat-history/server";
import type {
  DashboardStats,
  MaterialStatusBreakdown,
  UserRoleBreakdown,
} from "~/types/dashboard";
import type {
  DashboardCourse,
  DashboardRecentChat,
} from "~/components/dashboard/dashboard-view";
import type { User } from "~/lib/auth/types";

/** The dashboard reads the session user directly. */
export type DashboardUser = User;

/**
 * Everything the dashboard renders, resolved server-side so the page paints with
 * data on first byte (#1220). Shapes are slimmed to what `DashboardView` reads —
 * recent chats and courses drop the fields the panels never show — so the
 * serialized loader payload stays small.
 */
export type DashboardData = {
  stats: DashboardStats;
  recentChats: DashboardRecentChat[];
  /** Course cards for the standard (INSTRUCTOR/TA/STUDENT) panel; `[]` for the
   *  quick-actions roles (ADMIN/UNIT_ADMIN). */
  courses: DashboardCourse[];
  /** Server-side total for the caller's visible course list (#1041). */
  courseTotal: number;
  /** Platform-wide user count — ADMIN only. */
  userTotal?: number;
  /** Access-scoped active-course count — ADMIN and UNIT_ADMIN. */
  activeCourseTotal?: number;
};

/** Course cards render at most five rows, so that is all the loader fetches. */
const DASHBOARD_COURSE_LIMIT = 5;
/** Recent-conversations panel shows five. */
const RECENT_CHATS_LIMIT = 5;

function weekAgo(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d;
}

/**
 * Split live (non-deleted) materials by processing status for the analytics
 * donut. Pass a where filter to scope to a role's courses; deletedAt: null is
 * always applied so soft-deleted rows never inflate the chart.
 */
async function materialsByStatus(
  where: Prisma.CourseMaterialWhereInput,
): Promise<MaterialStatusBreakdown> {
  const rows = await prisma.courseMaterial.groupBy({
    by: ["status"],
    where: { ...where, deletedAt: null },
    _count: { _all: true },
  });
  const out: MaterialStatusBreakdown = { ready: 0, processing: 0, failed: 0 };
  for (const r of rows) {
    const n = r._count._all;
    if (r.status === "READY") out.ready = n;
    else if (r.status === "PROCESSING") out.processing = n;
    else if (r.status === "FAILED") out.failed = n;
  }
  return out;
}

/** Platform-wide user distribution by role for the ADMIN analytics donut. */
async function usersByRole(): Promise<UserRoleBreakdown> {
  const rows = await prisma.user.groupBy({ by: ["role"], _count: { _all: true } });
  const out: UserRoleBreakdown = { students: 0, instructors: 0, admins: 0, other: 0 };
  for (const r of rows) {
    const n = r._count._all;
    if (r.role === "STUDENT") out.students += n;
    else if (r.role === "INSTRUCTOR") out.instructors += n;
    else if (r.role === "ADMIN") out.admins += n;
    else out.other += n;
  }
  return out;
}

/** The access-scoped course rows a UNIT_ADMIN dashboard is computed from. */
type UnitAdminCourseScope = {
  id: string;
  instructorId: string | null;
  isActive: boolean;
}[];

/**
 * Every course a UNIT_ADMIN can see, with just the fields the stats and the
 * dashboard totals need. Resolved once per dashboard load and shared, so the
 * unit filter is built and the course table hit a single time rather than once
 * per consumer.
 */
async function loadUnitAdminCourseScope(
  rbacUser: Parameters<typeof buildCourseListFilter>[0],
): Promise<UnitAdminCourseScope> {
  const filter = await buildCourseListFilter(rbacUser);
  return prisma.course.findMany({
    where: filter,
    select: { id: true, instructorId: true, isActive: true },
  });
}

/**
 * Role-scoped dashboard statistics. Lifted verbatim from the old
 * `GET /api/dashboard/stats` loader so the route (still served for any client
 * caller) and the SSR dashboard loader share one implementation.
 *
 * `opts.unitAdminCourses` lets the SSR loader hand in the course scope it has
 * already resolved; without it (the API-route caller) this resolves its own.
 */
export async function computeDashboardStats(
  user: DashboardUser,
  opts: { unitAdminCourses?: UnitAdminCourseScope } = {},
): Promise<DashboardStats> {
  const role = user.role ?? "STUDENT";
  const week = weekAgo();

  if (role === "ADMIN") {
    const [chatCount, chatCountWeek, materialCount, studentCount, instructorCount, totalUsers, activeCourseCount] =
      await Promise.all([
        prisma.chat.count(),
        prisma.chat.count({ where: { createdAt: { gte: week } } }),
        prisma.courseMaterial.count({ where: { deletedAt: null } }),
        prisma.enrollment.count({ where: { role: "STUDENT", isActive: true } }),
        prisma.user.count({ where: { role: "INSTRUCTOR" } }),
        prisma.user.count(),
        prisma.course.count({ where: { isActive: true, deletedAt: null } }),
      ]);
    const [materialStatus, roleBreakdown] = await Promise.all([
      materialsByStatus({}),
      usersByRole(),
    ]);
    return {
      chatCount,
      chatCountWeek,
      materialCount,
      studentCount,
      instructorCount,
      totalUsers,
      activeCourseCount,
      materialsByStatus: materialStatus,
      usersByRole: roleBreakdown,
    };
  }

  if (role === "UNIT_ADMIN") {
    const rbacUser = { id: user.id, role: user.role, authorizedUnits: user.authorizedUnits ?? undefined };
    const courses = opts.unitAdminCourses ?? (await loadUnitAdminCourseScope(rbacUser));
    const courseIds = courses.map((c) => c.id);
    const uniqueInstructorIds = [...new Set(courses.map((c) => c.instructorId).filter(Boolean))];

    const [chatCount, chatCountWeek, materialCount, studentCount, activeCourseCount] = await Promise.all([
      courseIds.length ? prisma.chat.count({ where: { courseId: { in: courseIds } } }) : Promise.resolve(0),
      courseIds.length
        ? prisma.chat.count({ where: { courseId: { in: courseIds }, createdAt: { gte: week } } })
        : Promise.resolve(0),
      courseIds.length ? prisma.courseMaterial.count({ where: { courseId: { in: courseIds }, deletedAt: null } }) : Promise.resolve(0),
      courseIds.length
        ? prisma.enrollment.count({ where: { courseId: { in: courseIds }, role: "STUDENT", isActive: true } })
        : Promise.resolve(0),
      courses.filter((c) => c.isActive).length,
    ]);

    const materialStatus = courseIds.length
      ? await materialsByStatus({ courseId: { in: courseIds } })
      : { ready: 0, processing: 0, failed: 0 };

    return {
      chatCount,
      chatCountWeek,
      materialCount,
      studentCount,
      instructorCount: uniqueInstructorIds.length,
      totalUsers: 0,
      activeCourseCount,
      materialsByStatus: materialStatus,
    };
  }

  if (role === "INSTRUCTOR") {
    const enrollments = await prisma.enrollment.findMany({
      where: { userId: user.id, role: "INSTRUCTOR", isActive: true },
      select: { courseId: true },
    });
    const courseIds = enrollments.map((e) => e.courseId);

    const [chatCount, chatCountWeek, materialCount, studentCount] = await Promise.all([
      courseIds.length ? prisma.chat.count({ where: { courseId: { in: courseIds } } }) : Promise.resolve(0),
      courseIds.length
        ? prisma.chat.count({ where: { courseId: { in: courseIds }, createdAt: { gte: week } } })
        : Promise.resolve(0),
      courseIds.length ? prisma.courseMaterial.count({ where: { courseId: { in: courseIds }, deletedAt: null } }) : Promise.resolve(0),
      courseIds.length
        ? prisma.enrollment.count({ where: { courseId: { in: courseIds }, role: "STUDENT", isActive: true } })
        : Promise.resolve(0),
    ]);

    const materialStatus = courseIds.length
      ? await materialsByStatus({ courseId: { in: courseIds } })
      : { ready: 0, processing: 0, failed: 0 };

    return {
      chatCount,
      chatCountWeek,
      materialCount,
      studentCount,
      instructorCount: 0,
      totalUsers: 0,
      activeCourseCount: 0,
      materialsByStatus: materialStatus,
    };
  }

  // STUDENT platform role — covers both students and TAs (a TA is a STUDENT
  // user with an Enrollment(role=TA)). Scope to all active enrollments so a
  // TA's assisted courses count too.
  const enrollments = await prisma.enrollment.findMany({
    where: { userId: user.id, isActive: true },
    select: { courseId: true },
  });
  const courseIds = enrollments.map((e) => e.courseId);

  const [chatCount, chatCountWeek, materialCount] = await Promise.all([
    prisma.chat.count({ where: { userId: user.id } }),
    prisma.chat.count({ where: { userId: user.id, createdAt: { gte: week } } }),
    courseIds.length
      ? prisma.courseMaterial.count({ where: { courseId: { in: courseIds }, status: "READY", deletedAt: null } })
      : Promise.resolve(0),
  ]);

  return { chatCount, chatCountWeek, materialCount, studentCount: 0, instructorCount: 0, totalUsers: 0, activeCourseCount: 0 };
}

/** Slim a `listChats` row down to what the recent-conversations panel renders. */
function toDashboardRecentChat(chat: ChatHistoryItem): DashboardRecentChat {
  return {
    id: chat.id,
    title: chat.title,
    preview: chat.preview,
    courseCode: chat.courseCode,
    courseName: chat.courseName,
    userName: chat.userName,
    updatedAt: chat.updatedAt,
  };
}

/** Keep only the five fields the course-card panel renders. */
function toDashboardCourse(course: { id: string; code: string; name: string; term: string; year: number }): DashboardCourse {
  return { id: course.id, code: course.code, name: course.name, term: course.term, year: course.year };
}

/**
 * Resolve the whole dashboard server-side (#1220). Every read here was a
 * client fetch behind a role-specific hook; running them in the loader collapses
 * the waterfall (each hook mounted, then fetched) into one parallelized batch
 * and paints the dashboard with data on first byte.
 *
 * Branches on the *platform* role, not the effective role — a TA is a STUDENT
 * user and issues exactly the STUDENT course reads; the enrollment-derived "TA"
 * distinction only picks the display config, which the caller resolves
 * separately. So the `isTA` lookup and this batch are independent and the route
 * runs them concurrently.
 *
 * Per-role query gating is deliberate (#1041): non-admins never touch
 * `user.count()`, and the quick-actions roles ask for counts rather than course
 * pages.
 */
export async function loadDashboardData(user: DashboardUser): Promise<DashboardData> {
  const role = user.role ?? "STUDENT";
  const rbacUser = { id: user.id, role: user.role, authorizedUnits: user.authorizedUnits ?? undefined };
  const viewer = { id: user.id, role: user.role };

  if (role === "ADMIN") {
    const [stats, recentChats, userTotal, activeCourses] = await Promise.all([
      computeDashboardStats(user),
      listChats(viewer, { limit: RECENT_CHATS_LIMIT }),
      prisma.user.count(),
      listCoursesForUser(rbacUser, { countOnly: true, isActive: true }),
    ]);
    return {
      stats,
      recentChats: recentChats.map(toDashboardRecentChat),
      courses: [],
      courseTotal: 0,
      userTotal,
      activeCourseTotal: activeCourses.total,
    };
  }

  if (role === "UNIT_ADMIN") {
    // One access-scoped course read backs all three consumers: the stats, the
    // visible-course total, and the active-course total. Previously each built
    // its own `buildCourseListFilter` and hit the course table separately.
    const scope = loadUnitAdminCourseScope(rbacUser);
    const [stats, recentChats, courses] = await Promise.all([
      scope.then((unitAdminCourses) => computeDashboardStats(user, { unitAdminCourses })),
      listChats(viewer, { limit: RECENT_CHATS_LIMIT }),
      scope,
    ]);
    return {
      stats,
      recentChats: recentChats.map(toDashboardRecentChat),
      courses: [],
      courseTotal: courses.length,
      activeCourseTotal: courses.filter((c) => c.isActive).length,
    };
  }

  // INSTRUCTOR / TA / STUDENT — a course-card panel plus the server-side total.
  const [stats, recentChats, coursePage] = await Promise.all([
    computeDashboardStats(user),
    listChats(viewer, { limit: RECENT_CHATS_LIMIT }),
    listCoursesForUser(rbacUser, { pageSize: DASHBOARD_COURSE_LIMIT }),
  ]);
  return {
    stats,
    recentChats: recentChats.map(toDashboardRecentChat),
    courses: coursePage.courses.map(toDashboardCourse),
    courseTotal: coursePage.total,
  };
}
