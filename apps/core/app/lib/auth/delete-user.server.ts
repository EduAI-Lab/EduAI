import { Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { adminFloorViolation } from "~/lib/auth/admin-floor.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, type RequestContext } from "~/lib/request-context.server";

export type DeleteUserError =
  | "CANNOT_DELETE_SELF"
  | "USER_NOT_FOUND"
  | "ADMIN_FLOOR_VIOLATION"
  | "CANNOT_DELETE_USER_WITH_DATA";

export type DeleteUserResult =
  | { ok: true; deleted: { id: string; name: string | null; email: string } }
  | { error: DeleteUserError };

export function userEntityLabel(
  name: string | null | undefined,
  email: string | null | undefined,
): string | null {
  if (email && name) return `${name} <${email}>`;
  return email ?? name ?? null;
}

/**
 * Hard-deletes a user and writes the USER_DELETED audit entry. Shared by
 * DELETE /api/users/:id and the admin-chat deleteUser tool so they can't drift.
 * AI interaction rows keep their metrics but lose their text and owner (#1959).
 */
export async function deleteUserAccount(
  actor: { id: string; role?: string | null },
  userId: string,
  requestContext?: Partial<RequestContext>,
): Promise<DeleteUserResult> {
  if (userId === actor.id) {
    return { error: "CANNOT_DELETE_SELF" };
  }

  let result: DeleteUserResult;
  try {
    result = await prisma.$transaction(async (tx): Promise<DeleteUserResult> => {
      const target = await tx.user.findUnique({
        where: { id: userId },
        select: { role: true, isActive: true },
      });
      if (!target) {
        return { error: "USER_NOT_FOUND" };
      }
      // AUTH-04: hard-delete of an active ADMIN must leave >= 1 active ADMIN.
      if (target.role === "ADMIN" && target.isActive) {
        const violation = await adminFloorViolation(tx, userId);
        if (violation) return violation;
      }
      await tx.aIInteraction.updateMany({
        where: { userId },
        data: { query: "", response: "" },
      });
      const deleted = await tx.user.delete({
        where: { id: userId },
        select: { id: true, name: true, email: true },
      });
      return { ok: true, deleted };
    });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { error: "USER_NOT_FOUND" };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return { error: "CANNOT_DELETE_USER_WITH_DATA" };
    }
    throw error;
  }

  if ("ok" in result) {
    fireAndForget(
      logAuditAction({
        ...getActorContext(actor),
        ...requestContext,
        actionCode: "USER_DELETED",
        category: "USER",
        entityType: "User",
        entityId: result.deleted.id,
        entityLabel: userEntityLabel(result.deleted.name, result.deleted.email),
        details: { email: result.deleted.email },
      }),
    );
  }
  return result;
}
