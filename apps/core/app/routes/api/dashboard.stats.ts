import type { LoaderFunctionArgs } from "react-router";
import type { Prisma } from "@prisma/client";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { buildCourseListFilter } from "~/lib/auth/course-access.server";
import type {
  DashboardStats,
  MaterialStatusBreakdown,
  UserRoleBreakdown,
} from "~/types/dashboard";

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

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const user = session.user;
  const role = user.role ?? "STUDENT";
  const week = weekAgo();

  let stats: DashboardStats;

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
    stats = {
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

  } else if (role === "UNIT_ADMIN") {
    const rbacUser = { id: user.id, role: user.role, authorizedUnits: user.authorizedUnits ?? undefined };
    const filter = await buildCourseListFilter(rbacUser);
    const courses = await prisma.course.findMany({ where: filter, select: { id: true, instructorId: true, isActive: true } });
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

    stats = {
      chatCount,
      chatCountWeek,
      materialCount,
      studentCount,
      instructorCount: uniqueInstructorIds.length,
      totalUsers: 0,
      activeCourseCount,
      materialsByStatus: materialStatus,
    };

  } else if (role === "INSTRUCTOR") {
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

    stats = {
      chatCount,
      chatCountWeek,
      materialCount,
      studentCount,
      instructorCount: 0,
      totalUsers: 0,
      activeCourseCount: 0,
      materialsByStatus: materialStatus,
    };

  } else {
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

    stats = { chatCount, chatCountWeek, materialCount, studentCount: 0, instructorCount: 0, totalUsers: 0, activeCourseCount: 0 };
  }

  return new Response(JSON.stringify(stats), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
