/**
 * GET /api/courses/:courseId/chats — list student chats in a course (§5c).
 *
 * A new capability gated by two grant flags (off by default):
 *   - ADMIN: always allowed.
 *   - INSTRUCTOR with `instructors.canViewCourseChats`.
 *   - UNIT_ADMIN with `unitAdmins.canViewUnitChats`.
 *
 * Returns chat metadata only (id, owner id + name, title, timestamps) — never
 * message bodies. General (non-course) chats are excluded by the `courseId`
 * filter.
 */
import type { LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import { getPolicy, logPolicyDenial } from "~/lib/policy.server";
import prisma from "~/lib/prisma.server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export async function loader({ request, params }: LoaderFunctionArgs) {
  const courseId = params.courseId;
  if (!courseId) {
    return json({ error: "Course ID is required" }, 400);
  }

  const session = await auth.api.getSession(request);
  if (!session?.user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { course, access } = await resolveCourseAccessWithCourse(session.user, courseId);
  if (!course) {
    return json({ error: "COURSE_NOT_FOUND" }, 404);
  }
  if (!access) {
    return json({ error: "Forbidden" }, 403);
  }

  // ADMIN always; instructor/unit require the relevant grant flag.
  if (access.level !== "admin") {
    if (access.level === "instructor") {
      if (!(await getPolicy("instructors.canViewCourseChats"))) {
        logPolicyDenial({
          policyKey: "instructors.canViewCourseChats",
          userId: session.user.id,
          role: session.user.role,
          action: "course.chats.view",
          courseId,
        });
        return json({ error: "Forbidden" }, 403);
      }
    } else if (access.level === "unit") {
      if (!(await getPolicy("unitAdmins.canViewUnitChats"))) {
        logPolicyDenial({
          policyKey: "unitAdmins.canViewUnitChats",
          userId: session.user.id,
          role: session.user.role,
          action: "course.chats.view",
          courseId,
        });
        return json({ error: "Forbidden" }, 403);
      }
    } else {
      // TA / STUDENT cannot read others' course chats.
      return json({ error: "Forbidden" }, 403);
    }
  }

  const chats = await prisma.chat.findMany({
    where: { courseId },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      user: { select: { id: true, name: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return json({
    chats: chats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      ownerId: chat.user.id,
      ownerName: chat.user.name,
      createdAt: chat.createdAt.toISOString(),
      updatedAt: chat.updatedAt.toISOString(),
    })),
  });
}
