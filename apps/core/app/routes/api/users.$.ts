import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import { createUserSchema, updateUserSchema } from "~/lib/auth/schemas";
import { areValidDisciplineCodes } from "~/lib/disciplines/server";
import { applyStudentIdAndResolveEnrollments } from "~/lib/canvas/link-roster.server";
import { normalizeStudentId } from "~/lib/canvas/enrollment-link.server";
import {
  clearStudentIdStorage,
  prepareStudentIdStorage,
  readStoredStudentId,
  studentIdMatchFilter,
} from "~/lib/canvas/student-id.server";
import { fireAndForget, logAuditAction, logSecurityEvent } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

// Identity events label the subject by email (unique) plus name for readability, so two
// users who share a display name stay distinguishable in the log viewer. Email is the
// stable identifier even after the user row is gone; name is included only when present.
function userEntityLabel(
  name: string | null | undefined,
  email: string | null | undefined,
): string | null {
  if (email && name) return `${name} <${email}>`;
  return email ?? name ?? null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  return handleRequest(request);
}

export async function action({ request }: ActionFunctionArgs) {
  return handleRequest(request);
}

async function handleRequest(request: Request) {
  const url = new URL(request.url);
  const requestContext = getRequestContext(request);

  // Records an admin-only access rejection so security triage can spot probing of the user API.
  const logAdminDenied = (actor: { id: string; role?: string | null; email?: string | null } | null) =>
    fireAndForget(
      logSecurityEvent({
        ...getActorContext(actor),
        ...requestContext,
        actionCode: "ADMIN_ACCESS_DENIED",
        outcome: "DENIED",
        entityType: "User",
        entityId: actor?.id ?? null,
        entityLabel: actor?.email ?? null,
        ...(actor?.email ? { details: { email: actor.email } } : {}),
      }),
    );

  switch (request.method) {
    case "GET": {
      const session = await auth.api.getSession(request);
      if (!session?.user || session.user.role !== "ADMIN") {
        logAdminDenied(session?.user ?? null);
        return new Response("Forbidden: Admins only", { status: 403 });
      }

      const users = await prisma.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          role: true,
          isActive: true,
          emailVerified: true,
          authorizedUnits: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              enrollments: true,
              taughtCourses: true,
              aiInteractions: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' }
      });

      // A TA is an Enrollment with role=TA, so "assisted courses" is counted from
      // enrollments rather than the (removed) courseTAs relation.
      const taCounts = await prisma.enrollment.groupBy({
        by: ["userId"],
        where: { role: "TA", isActive: true, userId: { in: users.map((u) => u.id) } },
        _count: { _all: true },
      });
      const taCountByUser = new Map(taCounts.map((t) => [t.userId, t._count._all]));

      const mapped = users.map(({ _count, ...u }) => ({
        ...u,
        _count: {
          enrolledCourses: _count.enrollments,
          assistedCourses: taCountByUser.get(u.id) ?? 0,
          taughtCourses: _count.taughtCourses,
          aiInteractions: _count.aiInteractions,
        },
      }));

      return new Response(JSON.stringify(mapped), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "POST": {
      const session = await auth.api.getSession(request);
      if (!session?.user || session.user.role !== "ADMIN") {
        logAdminDenied(session?.user ?? null);
        return new Response("Forbidden: Admins only", { status: 403 });
      }

      const body = await request.json();
      const result = createUserSchema.safeParse(body);

      if (!result.success) {
        return new Response(
          JSON.stringify({
            error: "Invalid input",
            details: result.error.flatten(),
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // §541: authorizedUnits codes must exist in the Discipline table (array
      // field — no FK backstop, so the check is the only guard).
      if (
        result.data.authorizedUnits &&
        !(await areValidDisciplineCodes(result.data.authorizedUnits))
      ) {
        return new Response(JSON.stringify({ error: "UNKNOWN_UNIT" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        const { _count, ...created } = await prisma.user.create({
          data: {
            ...result.data,
            emailVerified: false, // New users need to verify their email
          },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            role: true,
            isActive: true,
            emailVerified: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: {
                enrollments: true,
                taughtCourses: true,
                aiInteractions: true,
              },
            },
          },
        });

        const user = {
          ...created,
          _count: {
            enrolledCourses: _count.enrollments,
            // Freshly created user has no enrollments yet.
            assistedCourses: 0,
            taughtCourses: _count.taughtCourses,
            aiInteractions: _count.aiInteractions,
          },
        };

        fireAndForget(
          logAuditAction({
            ...getActorContext(session.user),
            ...requestContext,
            actionCode: "USER_CREATED",
            category: "USER",
            entityType: "User",
            entityId: created.id,
            entityLabel: userEntityLabel(created.name, created.email),
            details: { role: created.role, email: created.email },
          }),
        );

        return new Response(JSON.stringify(user), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error: any) {
        if (error.code === 'P2002') {
          return new Response(
            JSON.stringify({ error: "Email already exists" }),
            { status: 409, headers: { "Content-Type": "application/json" } }
          );
        }
        throw error;
      }
    }

    case "PATCH": {
      const idMatch = url.pathname.match(/\/api\/users\/([^/]+)/);
      const userId = idMatch?.[1];

      if (!userId) {
        return new Response("Missing user ID", { status: 400 });
      }

      const session = await auth.api.getSession(request);
      if (!session?.user || session.user.role !== "ADMIN") {
        logAdminDenied(session?.user ?? null);
        return new Response("Forbidden: Admins only", { status: 403 });
      }

      const body = await request.json();

      // Self-lockout guards (§4): an admin cannot deactivate themselves or
      // change their own role (#297).
      if (userId === session.user.id) {
        if (body.isActive === false) {
          return new Response(
            JSON.stringify({ error: "Cannot deactivate your own account" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        if (body.role !== undefined && body.role !== session.user.role) {
          return new Response(
            JSON.stringify({ error: "Cannot change your own role" }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
      }

      const result = updateUserSchema.safeParse(body);

      if (!result.success) {
        return new Response(
          JSON.stringify({
            error: "Invalid input",
            details: result.error.flatten(),
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // #297: authorizedUnits only makes sense on a UNIT_ADMIN — reject
      // writes against any other target role (considering a role change in
      // the same request).
      if (result.data.authorizedUnits !== undefined) {
        // §541: every code must exist in the Discipline table. Checked first,
        // since code validity is independent of the target user.
        if (!(await areValidDisciplineCodes(result.data.authorizedUnits))) {
          return new Response(JSON.stringify({ error: "UNKNOWN_UNIT" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const target = await prisma.user.findUnique({
          where: { id: userId },
          select: { role: true },
        });
        if (!target) {
          return new Response("User not found", { status: 404 });
        }
        const effectiveRole = result.data.role ?? target.role;
        if (effectiveRole !== "UNIT_ADMIN") {
          return new Response(JSON.stringify({ error: "ROLE_MISMATCH" }), {
            status: 422,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      try {
        const { studentId: studentIdInput, ...userUpdateFields } = result.data;
        const updateData: Record<string, unknown> = { ...userUpdateFields };

        if (studentIdInput !== undefined) {
          const normalizedStudentId = normalizeStudentId(studentIdInput);
          if (normalizedStudentId) {
            const takenByOther = await prisma.user.findFirst({
              where: {
                ...studentIdMatchFilter(normalizedStudentId),
                id: { not: userId },
              },
              select: { id: true },
            });
            if (takenByOther) {
              return new Response(
                JSON.stringify({ error: "Student number is already linked to another account" }),
                { status: 409, headers: { "Content-Type": "application/json" } },
              );
            }
            Object.assign(updateData, prepareStudentIdStorage(normalizedStudentId));
          } else {
            Object.assign(updateData, clearStudentIdStorage());
          }
        }

        const { _count, ...updated } = await prisma.user.update({
          where: { id: userId },
          data: updateData,
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            role: true,
            studentId: true,
            isActive: true,
            emailVerified: true,
            authorizedUnits: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: {
                enrollments: true,
                taughtCourses: true,
                aiInteractions: true,
              },
            },
          },
        });

        if (studentIdInput !== undefined) {
          await applyStudentIdAndResolveEnrollments(userId, studentIdInput);
        }

        // A TA is an Enrollment with role=TA (no separate courseTAs relation).
        const assistedCourses = await prisma.enrollment.count({
          where: { userId, role: "TA", isActive: true },
        });

        const user = {
          ...updated,
          studentId: readStoredStudentId(updated.studentId),
          _count: {
            enrolledCourses: _count.enrollments,
            assistedCourses,
            taughtCourses: _count.taughtCourses,
            aiInteractions: _count.aiInteractions,
          },
        };

        // Pick the most specific action code so admins can filter role/deactivation changes directly.
        const changedFields = Object.keys(result.data);
        const actionCode =
          result.data.role !== undefined
            ? "USER_ROLE_CHANGED"
            : result.data.isActive === false
              ? "USER_DEACTIVATED"
              : result.data.isActive === true
                ? "USER_REACTIVATED"
                : "USER_UPDATED";
        fireAndForget(
          logAuditAction({
            ...getActorContext(session.user),
            ...requestContext,
            actionCode,
            category: "USER",
            entityType: "User",
            entityId: updated.id,
            entityLabel: userEntityLabel(updated.name, updated.email),
            // Identify the affected account by email; log changed field *names* (not
            // their values, which may carry other PII like studentId). newRole is only
            // meaningful on a role change, so omit it otherwise.
            details: {
              email: updated.email,
              changedFields,
              ...(result.data.role !== undefined ? { newRole: result.data.role } : {}),
            },
          }),
        );

        return new Response(JSON.stringify(user), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error: any) {
        if (error.code === 'P2025') {
          return new Response("User not found", { status: 404 });
        }
        if (error.code === 'P2002') {
          const field = error.meta?.target;
          const message =
            Array.isArray(field) &&
            (field.includes("studentId") || field.includes("studentIdLookup"))
              ? "Student number is already linked to another account"
              : "Email already exists";
          return new Response(
            JSON.stringify({ error: message }),
            { status: 409, headers: { "Content-Type": "application/json" } }
          );
        }
        throw error;
      }
    }

    case "DELETE": {
      const idMatch = url.pathname.match(/\/api\/users\/([^/]+)/);
      const userId = idMatch?.[1];

      if (!userId) {
        return new Response("Missing user ID", { status: 400 });
      }

      const session = await auth.api.getSession(request);
      if (!session?.user || session.user.role !== "ADMIN") {
        logAdminDenied(session?.user ?? null);
        return new Response("Forbidden: Admins only", { status: 403 });
      }

      // Prevent admin from deleting themselves
      if (userId === session.user.id) {
        return new Response(
          JSON.stringify({ error: "Cannot delete your own account" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      try {
        // Capture identifying fields before the row is gone so the audit entry
        // names the deleted account rather than only its id.
        const deleted = await prisma.user.delete({
          where: { id: userId },
          select: { id: true, name: true, email: true },
        });

        fireAndForget(
          logAuditAction({
            ...getActorContext(session.user),
            ...requestContext,
            actionCode: "USER_DELETED",
            category: "USER",
            entityType: "User",
            entityId: deleted.id,
            entityLabel: userEntityLabel(deleted.name, deleted.email),
            details: { email: deleted.email },
          }),
        );

        return new Response(null, { status: 204 });
      } catch (error: any) {
        if (error.code === 'P2025') {
          return new Response("User not found", { status: 404 });
        }
        if (error.code === 'P2003') {
          return new Response(
            JSON.stringify({ error: "Cannot delete user with existing data" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        throw error;
      }
    }

    default:
      return new Response("Method not allowed", { status: 405 });
  }
}
