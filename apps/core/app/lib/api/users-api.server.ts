import prisma from "~/lib/prisma.server";
import type { Prisma } from "@prisma/client";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import { createUserSchema, updateUserSchema } from "~/lib/auth/schemas";
import { assertValidUnits } from "~/lib/disciplines/guards.server";
import { reconcileUserTACourses } from "~/lib/courses/tas.server";
import { apiError, validationErrorFromZod } from "~/lib/api-error.server";
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

const activeStudentEnrollmentWhere = {
  role: "STUDENT",
  isActive: true,
} satisfies Prisma.EnrollmentWhereInput;

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
              enrollments: { where: activeStudentEnrollmentWhere },
              taughtCourses: true,
              aiInteractions: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      const taEnrollments = await prisma.enrollment.findMany({
        where: { role: "TA", isActive: true, userId: { in: users.map((u) => u.id) } },
        select: { userId: true, courseId: true },
      });
      const taCourseIdsByUser = new Map<string, string[]>();
      for (const enrollment of taEnrollments) {
        const courseIds = taCourseIdsByUser.get(enrollment.userId) ?? [];
        courseIds.push(enrollment.courseId);
        taCourseIdsByUser.set(enrollment.userId, courseIds);
      }

      const mapped = users.map(({ _count, ...u }) => ({
        ...u,
        taCourseIds: taCourseIdsByUser.get(u.id) ?? [],
        _count: {
          enrolledCourses: _count.enrollments,
          assistedCourses: taCourseIdsByUser.get(u.id)?.length ?? 0,
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

      const body = await request.json();
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

      if (result.data.role !== "UNIT_ADMIN" && (result.data.authorizedUnits?.length ?? 0) > 0) {
        return apiError(422, "ROLE_MISMATCH");
      }

      try {
        const createData = {
          ...result.data,
          authorizedUnits:
            result.data.role === "UNIT_ADMIN" ? (result.data.authorizedUnits ?? []) : [],
        };
        const { _count, ...created } = await prisma.user.create({
          data: {
            ...createData,
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
          taCourseIds: [],
          _count: {
            enrolledCourses: _count.enrollments,
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
        if (error.code === "P2002") {
          return apiError(409, "EMAIL_ALREADY_EXISTS");
        }
        throw error;
      }
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
      }

      let effectiveRole = result.data.role;
      let previousRole: typeof effectiveRole;
      if (
        result.data.role !== undefined ||
        result.data.authorizedUnits !== undefined ||
        result.data.taCourseIds !== undefined
      ) {
        const target = await prisma.user.findUnique({
          where: { id: userId },
          select: { role: true },
        });
        if (!target) {
          return apiError(404, "USER_NOT_FOUND");
        }
        previousRole = target.role;
        effectiveRole = result.data.role ?? target.role;
        if (effectiveRole !== "UNIT_ADMIN" && (result.data.authorizedUnits?.length ?? 0) > 0) {
          return apiError(422, "ROLE_MISMATCH");
        }
      }
      const platformRoleChanged =
        result.data.role !== undefined && previousRole !== effectiveRole;

      try {
        const {
          studentId: studentIdInput,
          taCourseIds,
          ...userUpdateFields
        } = result.data;
        const updateData: Record<string, unknown> = { ...userUpdateFields };

        if (result.data.role !== undefined && result.data.role !== "UNIT_ADMIN") {
          updateData.authorizedUnits = [];
        }

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

        const updateUser = (client: Pick<Prisma.TransactionClient, "user">) => client.user.update({
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
                enrollments: { where: activeStudentEnrollmentWhere },
                taughtCourses: true,
                aiInteractions: true,
              },
            },
          },
        });

        const shouldReconcileTACourses =
          taCourseIds !== undefined ||
          (result.data.role !== undefined && effectiveRole !== "STUDENT");

        let previousTACourseIds: string[] = [];
        let activeTACourseIds: string[];
        let updatedWithCount;
        if (shouldReconcileTACourses) {
          const transactionResult = await prisma.$transaction(async (tx) => {
            const previousTAEnrollments = await tx.enrollment.findMany({
              where: { userId, role: "TA", isActive: true },
              select: { courseId: true },
            });
            const reconciliation = await reconcileUserTACourses(
              tx,
              userId,
              effectiveRole!,
              taCourseIds ?? [],
            );
            if (reconciliation.error) {
              return { error: reconciliation.error } as const;
            }
            return {
              updated: await updateUser(tx),
              activeTACourseIds: reconciliation.activeTACourseIds,
              previousTACourseIds: previousTAEnrollments.map(
                (enrollment) => enrollment.courseId,
              ),
            } as const;
          });

          if (transactionResult.error) {
            const status =
              transactionResult.error === "TA_INSTRUCTOR_ENROLLMENT_CONFLICT"
                ? 409
                : transactionResult.error === "TA_COURSE_NOT_FOUND"
                  ? 404
                  : 422;
            return apiError(status, transactionResult.error);
          }
          updatedWithCount = transactionResult.updated!;
          activeTACourseIds = transactionResult.activeTACourseIds!;
          previousTACourseIds = transactionResult.previousTACourseIds!;
        } else {
          updatedWithCount = await updateUser(prisma);
          const activeTAEnrollments = await prisma.enrollment.findMany({
            where: { userId, role: "TA", isActive: true },
            select: { courseId: true },
          });
          activeTACourseIds = activeTAEnrollments.map(
            (enrollment) => enrollment.courseId,
          );
        }

        const { _count, ...updated } = updatedWithCount;

        if (studentIdInput !== undefined) {
          await applyStudentIdAndResolveEnrollments(userId, studentIdInput);
        }

        const previousTACourseIdSet = new Set(previousTACourseIds);
        const activeTACourseIdSet = new Set(activeTACourseIds);
        const taCourseIdsAdded = activeTACourseIds.filter(
          (courseId) => !previousTACourseIdSet.has(courseId),
        );
        const taCourseIdsRemoved = previousTACourseIds.filter(
          (courseId) => !activeTACourseIdSet.has(courseId),
        );

        const user = {
          ...updated,
          studentId: readStoredStudentId(updated.studentId),
          taCourseIds: activeTACourseIds,
          _count: {
            enrolledCourses: _count.enrollments,
            assistedCourses: activeTACourseIds.length,
            taughtCourses: _count.taughtCourses,
            aiInteractions: _count.aiInteractions,
          },
        };

        const changedFields = Object.keys(result.data);
        let actionCode = "USER_UPDATED";
        if (platformRoleChanged) {
          actionCode = "USER_ROLE_CHANGED";
        } else if (taCourseIds !== undefined) {
          actionCode = "USER_TA_COURSES_CHANGED";
        } else if (result.data.isActive === false) {
          actionCode = "USER_DEACTIVATED";
        } else if (result.data.isActive === true) {
          actionCode = "USER_REACTIVATED";
        }
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
              ...(platformRoleChanged
                ? { previousRole, newRole: effectiveRole }
                : {}),
              ...(shouldReconcileTACourses
                ? { taCourseIdsAdded, taCourseIdsRemoved }
                : {}),
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
