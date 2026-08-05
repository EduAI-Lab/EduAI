import prisma from "~/lib/prisma.server";
import type { Prisma, UserRole } from "@prisma/client";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import { createUserSchema, updateUserSchema } from "~/lib/auth/schemas";
import { assertValidUnits } from "~/lib/disciplines/guards.server";
import { reconcileUserTACourses } from "~/lib/courses/tas.server";
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
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import {
  paginatedResponse,
  parseIdsParam,
  parsePaginationParams,
  parseSearchParam,
  unpagedResponse,
  type Pagination,
} from "~/lib/pagination.server";

const USER_ROLES: UserRole[] = ["ADMIN", "UNIT_ADMIN", "INSTRUCTOR", "STUDENT"];

/** Columns the admin users table may sort by. Whitelisted so `sortBy` cannot reach arbitrary fields. */
const USER_SORT_FIELDS = [
  "name",
  "email",
  "role",
  "isActive",
  "emailVerified",
  "createdAt",
  "updatedAt",
] as const;
type UserSortField = (typeof USER_SORT_FIELDS)[number];

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
      if (!session?.user) {
        logAdminDenied(session?.user ?? null);
        return apiError(403, "Forbidden");
      }

      // The enrollment picker reuses this paginated endpoint, but only within
      // a course the caller can manage. Ordinary user-list reads remain ADMIN
      // only; `courseId` enables a narrowly scoped candidate search.
      const courseId = url.searchParams.get("courseId")?.trim() || null;
      let isCourseManager = false;
      if (courseId && session.user.role !== "ADMIN") {
        const { course, access } = await resolveCourseAccessWithCourse(session.user, courseId);
        isCourseManager = Boolean(course && access && access.rank >= 2);
      }
      if (session.user.role !== "ADMIN" && !isCourseManager) {
        logAdminDenied(session.user);
        return apiError(403, "Forbidden");
      }

      // #1041: `page`/`pageSize` are required; `?ids=` is the unpaged batch-lookup
      // escape hatch for callers resolving a known set of users (#1125).
      const idsResult = parseIdsParam(url.searchParams);
      if ("response" in idsResult) return idsResult.response;

      const search = parseSearchParam(url.searchParams);
      // `role` accepts a comma-separated list so the table's multi-select facet
      // maps to a single request.
      const roleFilter = (url.searchParams.get("role") ?? "")
        .split(",")
        .map((role) => role.trim())
        .filter(Boolean);
      const unknownRole = roleFilter.find((role) => !USER_ROLES.includes(role as UserRole));
      if (unknownRole) {
        return apiError(400, "VALIDATION_ERROR", { role: `Unknown role: ${unknownRole}` });
      }

      const isActiveParam = url.searchParams.get("isActive");

      const sortBy = url.searchParams.get("sortBy") ?? "createdAt";
      if (!USER_SORT_FIELDS.includes(sortBy as UserSortField)) {
        return apiError(400, "VALIDATION_ERROR", { sortBy: `Unknown sort field: ${sortBy}` });
      }
      const sortDir = url.searchParams.get("sortDir") === "asc" ? "asc" : "desc";
      const orderBy = { [sortBy]: sortDir } as Prisma.UserOrderByWithRelationInput;

      const where: Prisma.UserWhereInput = {};
      if (idsResult.ids) {
        where.id = { in: idsResult.ids };
      }
      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ];
      }
      if (roleFilter.length > 0) {
        where.role = { in: roleFilter as UserRole[] };
      }
      if (isActiveParam !== null) {
        where.isActive = isActiveParam === "true";
      }

      if (courseId) {
        // This mode is constrained to the picker contract so course managers
        // cannot turn it into a platform-wide user directory.
        if (
          roleFilter.length !== 1 ||
          roleFilter[0] !== "STUDENT" ||
          isActiveParam !== "true"
        ) {
          return apiError(400, "COURSE_CANDIDATES_REQUIRE_ACTIVE_STUDENTS");
        }

        const exclude = url.searchParams.get("exclude");
        if (exclude !== "enrolled" && exclude !== "ta") {
          return apiError(400, "COURSE_CANDIDATES_EXCLUDE_REQUIRED");
        }
        where.enrollments = {
          none:
            exclude === "ta"
              ? { courseId, role: "TA", isActive: true }
              : { courseId, isActive: true },
        };
      }

      let pagination: Pagination | null = null;
      if (!idsResult.ids) {
        const paginationResult = parsePaginationParams(url.searchParams);
        if ("response" in paginationResult) return paginationResult.response;
        pagination = paginationResult.pagination;
      }

      const userSelect = {
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
      } satisfies Prisma.UserFindManyArgs;

      const [total, users, statsTotal, statsActive, ...roleCounts] = pagination
        ? await prisma.$transaction([
            prisma.user.count({ where }),
            prisma.user.findMany({
              ...userSelect,
              where,
              orderBy,
              skip: pagination.skip,
              take: pagination.take,
            }),
            // Unfiltered platform-wide counts for the admin header, which must
            // not shift as the admin searches or pages.
            prisma.user.count(),
            prisma.user.count({ where: { isActive: true } }),
            // Role breakdown for dashboard charts. Callers used to derive this
            // by counting a full user list, which paging makes impossible.
            ...USER_ROLES.map((role) => prisma.user.count({ where: { role } })),
          ])
        : await (async () => {
            const rows = await prisma.user.findMany({
              ...userSelect,
              where,
              orderBy,
            });
            return [rows.length, rows, 0, 0, ...USER_ROLES.map(() => 0)] as const;
          })();

      // Scoped to the current page's user ids so this second query stays bounded.
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

      return pagination
        ? paginatedResponse(mapped, total, pagination, {
            stats: {
              total: statsTotal,
              active: statsActive,
              byRole: Object.fromEntries(
                USER_ROLES.map((role, index) => [role, (roleCounts[index] as number) ?? 0]),
              ),
            },
          })
        : unpagedResponse(mapped);
    }

    case "POST": {
      const session = apiKeySession ?? (await auth.api.getSession({ headers: request.headers }));
      if (!session?.user || session.user.role !== "ADMIN") {
        logAdminDenied(session?.user ?? null);
        return apiError(403, "Forbidden");
      }

      return withIdempotency(
        { request, route: "POST /api/users", actorId: session.user.id },
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
