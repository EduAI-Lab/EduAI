import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import { createUserSchema, updateUserSchema } from "~/lib/auth/schemas";
import { assertValidUnits } from "~/lib/disciplines/guards.server";
import { apiError, validationErrorFromZod } from "~/lib/api-error.server";
import { withIdempotency } from "~/lib/idempotency.server";
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

function userEntityLabel(
  name: string | null | undefined,
  email: string | null | undefined,
): string | null {
  if (email && name) return `${name} <${email}>`;
  return email ?? name ?? null;
}

export async function handleUsersApiRequest(request: Request) {
  const url = new URL(request.url);
  const requestContext = getRequestContext(request);

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

  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  switch (request.method) {
    case "GET": {
      const session = apiKeySession ?? (await auth.api.getSession({ headers: request.headers }));
      if (!session?.user || session.user.role !== "ADMIN") {
        logAdminDenied(session?.user ?? null);
        return apiError(403, "Forbidden");
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
        orderBy: { createdAt: "desc" },
      });

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
      const session = apiKeySession ?? (await auth.api.getSession({ headers: request.headers }));
      if (!session?.user || session.user.role !== "ADMIN") {
        logAdminDenied(session?.user ?? null);
        return apiError(403, "Forbidden");
      }

      return withIdempotency(
        { request, route: "POST /api/users" },
        async (body) => createUserFromBody(body, session.user, requestContext),
      );
    }

    case "PATCH": {
      const idMatch = url.pathname.match(/\/api\/users\/([^/]+)/);
      const userId = idMatch?.[1];

      if (!userId) {
        return apiError(400, "USER_ID_REQUIRED");
      }

      const session = apiKeySession ?? (await auth.api.getSession({ headers: request.headers }));
      if (!session?.user || session.user.role !== "ADMIN") {
        logAdminDenied(session?.user ?? null);
        return apiError(403, "Forbidden");
      }

      const body = await request.json();

      if (userId === session.user.id) {
        if (body.isActive === false) {
          return apiError(400, "CANNOT_DEACTIVATE_SELF");
        }
        if (body.role !== undefined && body.role !== session.user.role) {
          return apiError(403, "CANNOT_CHANGE_OWN_ROLE");
        }
      }

      const result = updateUserSchema.safeParse(body);

      if (!result.success) {
        return validationErrorFromZod(result.error);
      }

      if (result.data.authorizedUnits !== undefined) {
        // §541: every code must exist in the Discipline table. Checked first,
        // since code validity is independent of the target user.
        const unitGuard = await assertValidUnits(result.data.authorizedUnits);
        if (unitGuard) return unitGuard;
        const target = await prisma.user.findUnique({
          where: { id: userId },
          select: { role: true },
        });
        if (!target) {
          return apiError(404, "USER_NOT_FOUND");
        }
        const effectiveRole = result.data.role ?? target.role;
        if (effectiveRole !== "UNIT_ADMIN") {
          return apiError(422, "ROLE_MISMATCH");
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
              return apiError(409, "STUDENT_ID_ALREADY_LINKED");
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
        if (error.code === "P2025") {
          return apiError(404, "USER_NOT_FOUND");
        }
        if (error.code === "P2002") {
          const field = error.meta?.target;
          const message =
            Array.isArray(field) &&
            (field.includes("studentId") || field.includes("studentIdLookup"))
              ? "STUDENT_ID_ALREADY_LINKED"
              : "EMAIL_ALREADY_EXISTS";
          return apiError(409, message);
        }
        throw error;
      }
    }

    case "DELETE": {
      const idMatch = url.pathname.match(/\/api\/users\/([^/]+)/);
      const userId = idMatch?.[1];

      if (!userId) {
        return apiError(400, "USER_ID_REQUIRED");
      }

      const session = apiKeySession ?? (await auth.api.getSession({ headers: request.headers }));
      if (!session?.user || session.user.role !== "ADMIN") {
        logAdminDenied(session?.user ?? null);
        return apiError(403, "Forbidden");
      }

      if (userId === session.user.id) {
        return apiError(400, "CANNOT_DELETE_SELF");
      }

      try {
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
        if (error.code === "P2025") {
          return apiError(404, "USER_NOT_FOUND");
        }
        if (error.code === "P2003") {
          return apiError(400, "CANNOT_DELETE_USER_WITH_DATA");
        }
        throw error;
      }
    }

    default:
      return apiError(405, "METHOD_NOT_ALLOWED");
  }
}

async function createUserFromBody(
  body: Record<string, unknown> | null,
  actor: { id: string; name?: string | null; email?: string | null },
  requestContext: ReturnType<typeof getRequestContext>,
): Promise<Response> {
  const result = createUserSchema.safeParse(body);

  if (!result.success) {
    return validationErrorFromZod(result.error);
  }

  // §541: authorizedUnits codes must exist in the Discipline table (array
  // field — no FK backstop, so the check is the only guard).
  if (result.data.authorizedUnits) {
    const unitGuard = await assertValidUnits(result.data.authorizedUnits);
    if (unitGuard) return unitGuard;
  }

  try {
    const { _count, ...created } = await prisma.user.create({
      data: {
        ...result.data,
        emailVerified: false,
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
        assistedCourses: 0,
        taughtCourses: _count.taughtCourses,
        aiInteractions: _count.aiInteractions,
      },
    };

    fireAndForget(
      logAuditAction({
        ...getActorContext(actor),
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
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      return apiError(409, "EMAIL_ALREADY_EXISTS");
    }
    throw error;
  }
}
