import type { Prisma } from "@prisma/client";

/**
 * AUTH-04 admin-floor invariant: the platform must always retain >= 1 active
 * ADMIN. Applies to every caller, including another ADMIN demoting,
 * deactivating, or deleting a peer, with no override. Caller must run this
 * inside the same transaction as the write so the check-then-write is atomic.
 *
 * Takes a transaction-scoped advisory lock first so two concurrent removals
 * cannot each count the other admin, both pass, and both commit (leaving
 * zero active admins under default READ COMMITTED isolation).
 */
export async function adminFloorViolation(
  tx: Pick<Prisma.TransactionClient, "user" | "$executeRaw">,
  userId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"admin-floor"}))`;
  const remainingAdmins = await tx.user.count({
    where: { role: "ADMIN", isActive: true, id: { not: userId } },
  });
  if (remainingAdmins === 0) {
    return { status: "409", error: "ADMIN_FLOOR_VIOLATION" } as const;
  }
  return null;
}
