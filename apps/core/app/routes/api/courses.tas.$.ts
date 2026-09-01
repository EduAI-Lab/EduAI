import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { getCourseTA, addCourseTA, removeCourseTA } from "~/lib/courses/tas.server";
import prisma from "~/lib/prisma.server";
import { resolveCourseAccess } from "~/lib/rbac/resolve-course-access.server";
import { resolvePolicyGate } from "~/lib/rbac/permissions";
import { getPolicy, denyByPolicy } from "~/lib/policy.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { withErrorResponse } from "~/lib/errors.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  return withErrorResponse(
    async () => {
      const session = await getRequestSession(request);
      if (!session?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const courseId = params.courseId;
      if (!courseId) {
        return new Response(JSON.stringify({ error: "Course ID is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const course = await prisma.course.findUnique({
        where: { id: courseId },
        select: { id: true, instructorId: true, department: true },
      });

      if (!course) {
        return new Response(JSON.stringify({ error: "Course not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      let authorizedUnits: string[] = [];
      if (session.user.role === "UNIT_ADMIN") {
        const dbUser = await prisma.user.findUnique({
          where: { id: session.user.id },
          select: { authorizedUnits: true },
        });
        authorizedUnits = dbUser?.authorizedUnits ?? [];
      }

      const rbacUser = {
        id: session.user.id,
        role: session.user.role as import("~/lib/rbac/types").UserRole,
        authorizedUnits,
      };
      const access = await resolveCourseAccess(rbacUser, course);

      // Reading the TA roster is allowed for anyone with course access (students,
      // TAs, instructors, admins). Mutations remain gated in `action` below.
      if (!access) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }

      // PII BOUNDARY (#1571): `getCourseTA` returns TA name + email. Student-tier
      // callers get the roster (name + id) so they can see who their TAs are, but
      // NOT contact emails — matching `courses.enrollments.ts`, which withholds
      // roster PII from students. Redact at this endpoint rather than in the shared
      // service so instructor/admin callers still receive the email they rely on.
      const tas = await getCourseTA(courseId);
      const visibleTAs =
        access === "student"
          ? tas.map(({ user, ...ta }) => ({ ...ta, user: { id: user.id, name: user.name } }))
          : tas;
      return new Response(JSON.stringify({ tas: visibleTAs }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    { request },
  );
}

export async function action({ request, params }: ActionFunctionArgs) {
  return withErrorResponse(
    async () => {
      const courseId = params.courseId;
      if (!courseId) {
        return new Response(JSON.stringify({ error: "Course ID is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const session = await getRequestSession(request);
      if (!session?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const course = await prisma.course.findUnique({
        where: { id: courseId },
        select: { id: true, instructorId: true, department: true },
      });

      if (!course) {
        return new Response(JSON.stringify({ error: "Course not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      let authorizedUnits: string[] = [];
      if (session.user.role === "UNIT_ADMIN") {
        const dbUser = await prisma.user.findUnique({
          where: { id: session.user.id },
          select: { authorizedUnits: true },
        });
        authorizedUnits = dbUser?.authorizedUnits ?? [];
      }

      const rbacUser = {
        id: session.user.id,
        role: session.user.role as import("~/lib/rbac/types").UserRole,
        authorizedUnits,
      };
      const access = await resolveCourseAccess(rbacUser, course);

      // ADMIN / UNIT_ADMIN may always manage TAs. An INSTRUCTOR who owns the course
      // may also manage TAs when `instructors.canManageEnrollments` is on; the gate
      // is resolved centrally so this mirrors the enrollments endpoint and can't
      // drift. Other roles are forbidden.
      const taGate = resolvePolicyGate(access, "manageEnrollments");
      if (taGate === "never") {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (taGate !== "always" && !(await getPolicy(taGate))) {
        return denyByPolicy({
          request,
          policyKey: taGate,
          user: session.user,
          action: "courseTA.manage",
          courseId,
        });
      }

      const body = await request.json();
      const requestContext = getRequestContext(request);

      switch (request.method) {
        case "POST": {
          const result = await addCourseTA(courseId, body);
          if ("error" in result) {
            const status = result.error === "User is already a TA for this course" ? 409 : 400;
            return new Response(JSON.stringify(result), {
              status,
              headers: { "Content-Type": "application/json" },
            });
          }
          fireAndForget(
            logAuditAction({
              ...getActorContext(session?.user ?? null),
              ...requestContext,
              actionCode: "COURSE_TA_ASSIGNED",
              category: "ENROLLMENT",
              entityType: "CourseTA",
              entityId: result.ta.id,
              entityLabel: result.ta.user?.name ?? null,
              details: { courseId, targetUserId: result.ta.user.id },
            }),
          );
          return new Response(JSON.stringify(result.ta), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }

        case "DELETE": {
          const result = await removeCourseTA(courseId, body);
          if ("error" in result) {
            const status = result.error === "TA not found for this course" ? 404 : 400;
            return new Response(JSON.stringify(result), {
              status,
              headers: { "Content-Type": "application/json" },
            });
          }
          fireAndForget(
            logAuditAction({
              ...getActorContext(session?.user ?? null),
              ...requestContext,
              actionCode: "COURSE_TA_REMOVED",
              category: "ENROLLMENT",
              entityType: "CourseTA",
              entityId: result.taId,
              entityLabel: result.taName,
              details: { courseId, targetUserId: body?.userId },
            }),
          );
          return new Response(null, { status: 204 });
        }

        default:
          return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json" },
          });
      }
    },
    { request },
  );
}
