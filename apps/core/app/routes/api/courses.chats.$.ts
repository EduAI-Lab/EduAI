/**
 * GET /api/courses/:courseId/chats — list student chats in a course (§5c).
 *
 * A new capability gated by two grant flags (off by default):
 *   - ADMIN: always allowed.
 *   - INSTRUCTOR with `instructors.canViewCourseChats`.
 *   - UNIT_ADMIN with `unitAdmins.canViewUnitChats`.
 *
 * Returns chat metadata only (id, owner id + name, title, timestamps) — never
 * message bodies. Only chats owned by an active STUDENT of this course are
 * listed: general (non-course) chats are excluded by the `courseId` filter, and
 * staff (instructor/TA/unit-admin) chats tagged to the course are excluded by
 * the owner-role filter.
 */
import type { LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import { courseChatViewPolicyKey } from "~/lib/rbac/permissions";
import { getPolicy, denyByPolicy } from "~/lib/policy.server";
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

  // §5c chat visibility via the shared gate: ADMIN always; instructor/unit
  // require their grant flag; TA/STUDENT never read others' course chats.
  const gate = courseChatViewPolicyKey(access.level);
  if (gate === "never") {
    return json({ error: "Forbidden" }, 403);
  }
  if (gate !== "always" && !(await getPolicy(gate))) {
    return denyByPolicy({
      request,
      policyKey: gate,
      user: session.user,
      action: "course.chats.view",
      courseId,
    });
  }

  const chats = await prisma.chat.findMany({
    // Owner must be an active STUDENT of this course — excludes staff chats
    // (instructor/TA/unit-admin) that are also tagged to the course.
    where: {
      courseId,
      user: {
        enrollments: { some: { courseId, role: "STUDENT", isActive: true } },
      },
    },
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
