import type { LoaderFunctionArgs } from "react-router";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { buildCourseListFilter } from "~/lib/auth/course-access.server";
import type { DashboardStats } from "~/types/dashboard";

function weekAgo(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);
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
    stats = { chatCount, chatCountWeek, materialCount, studentCount, instructorCount, totalUsers, activeCourseCount };

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

    stats = {
      chatCount,
      chatCountWeek,
      materialCount,
      studentCount,
      instructorCount: uniqueInstructorIds.length,
      totalUsers: 0,
      activeCourseCount,
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

    stats = { chatCount, chatCountWeek, materialCount, studentCount, instructorCount: 0, totalUsers: 0, activeCourseCount: 0 };

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
