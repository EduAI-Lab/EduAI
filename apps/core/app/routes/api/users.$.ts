import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import { createUserSchema, updateUserSchema } from "~/lib/auth/schemas";
import { apiError, jsonResponse, validationErrorFromZod } from "~/lib/api-error.server";
import { applyStudentIdAndResolveEnrollments } from "~/lib/canvas/link-roster.server";
import { normalizeStudentId } from "~/lib/canvas/enrollment-link.server";
import {
  clearStudentIdStorage,
  prepareStudentIdStorage,
  readStoredStudentId,
  studentIdMatchFilter,
} from "~/lib/canvas/student-id.server";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  return handleRequest(request);
}

export async function action({ request }: ActionFunctionArgs) {
  return handleRequest(request);
}

async function handleRequest(request: Request) {
  const url = new URL(request.url);

  // If an API key is provided, only ADMIN users may proceed
  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  switch (request.method) {
    case "GET": {
      const session = apiKeySession ?? await auth.api.getSession(request);
      if (!session?.user || session.user.role !== "ADMIN") {
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
              courseTAs: true,
              taughtCourses: true,
              aiInteractions: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' }
      });

      const mapped = users.map(({ _count, ...u }) => ({
        ...u,
        _count: {
          enrolledCourses: _count.enrollments,
          assistedCourses: _count.courseTAs,
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
      const session = apiKeySession ?? await auth.api.getSession(request);
      if (!session?.user || session.user.role !== "ADMIN") {
        return apiError(403, "Forbidden");
      }

      const body = await request.json();
      const result = createUserSchema.safeParse(body);

      if (!result.success) {
        return validationErrorFromZod(result.error);
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
                courseTAs: true,
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
            assistedCourses: _count.courseTAs,
            taughtCourses: _count.taughtCourses,
            aiInteractions: _count.aiInteractions,
          },
        };

        return new Response(JSON.stringify(user), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error: any) {
        if (error.code === 'P2002') {
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

      const session = apiKeySession ?? await auth.api.getSession(request);
      if (!session?.user || session.user.role !== "ADMIN") {
        return apiError(403, "Forbidden");
      }

      const body = await request.json();

      // Self-lockout guards (§4): an admin cannot deactivate themselves or
      // change their own role (#297).
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

      // #297: authorizedUnits only makes sense on a UNIT_ADMIN — reject
      // writes against any other target role (considering a role change in
      // the same request).
      if (result.data.authorizedUnits !== undefined) {
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
                courseTAs: true,
                taughtCourses: true,
                aiInteractions: true,
              },
            },
          },
        });

        if (studentIdInput !== undefined) {
          await applyStudentIdAndResolveEnrollments(userId, studentIdInput);
        }

        const user = {
          ...updated,
          studentId: readStoredStudentId(updated.studentId),
          _count: {
            enrolledCourses: _count.enrollments,
            assistedCourses: _count.courseTAs,
            taughtCourses: _count.taughtCourses,
            aiInteractions: _count.aiInteractions,
          },
        };

        return new Response(JSON.stringify(user), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error: any) {
        if (error.code === 'P2025') {
          return apiError(404, "USER_NOT_FOUND");
        }
        if (error.code === 'P2002') {
          const field = error.meta?.target;
          const message =
            Array.isArray(field) &&
            (field.includes("studentId") || field.includes("studentIdLookup"))
              ? "Student number is already linked to another account"
              : "Email already exists";
          return apiError(409, message === "Email already exists" ? "EMAIL_ALREADY_EXISTS" : "STUDENT_ID_ALREADY_LINKED");
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

      const session = apiKeySession ?? await auth.api.getSession(request);
      if (!session?.user || session.user.role !== "ADMIN") {
        return apiError(403, "Forbidden");
      }

      // Prevent admin from deleting themselves
      if (userId === session.user.id) {
        return apiError(400, "CANNOT_DELETE_SELF");
      }

      try {
        await prisma.user.delete({
          where: { id: userId },
        });

        return new Response(null, { status: 204 });
      } catch (error: any) {
        if (error.code === 'P2025') {
          return apiError(404, "USER_NOT_FOUND");
        }
        if (error.code === 'P2003') {
          return apiError(400, "CANNOT_DELETE_USER_WITH_DATA");
        }
        throw error;
      }
    }

    default:
      return apiError(405, "METHOD_NOT_ALLOWED");
  }
}
