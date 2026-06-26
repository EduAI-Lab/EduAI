import prisma from "~/lib/prisma.server";

export const PASSWORD_HISTORY_LIMIT = 10;

type VerifyFn = (data: { password: string; hash: string }) => Promise<boolean>;

/**
 * Returns whether a password matches the user's current password or recent
 * password history.
 */
export async function isPasswordReused({
  userId,
  candidate,
  verify,
}: {
  userId: string;
  candidate: string;
  verify: VerifyFn;
}): Promise<boolean> {
  const [historyRows, userWithAccount] = await Promise.all([
    prisma.passwordHistory.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: PASSWORD_HISTORY_LIMIT,
      select: { passwordHash: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { accounts: { where: { providerId: "credential" }, select: { password: true } } },
    }),
  ]);

  const currentHash = userWithAccount?.accounts[0]?.password ?? null;

  const hashes = [
    ...historyRows.map((r) => r.passwordHash),
    ...(currentHash ? [currentHash] : []),
  ];

  for (const hash of hashes) {
    if (await verify({ password: candidate, hash })) {
      return true;
    }
  }

  return false;
}

/**
 * Stores a password hash and trims password history to the configured limit.
 */
export async function recordPasswordHistory({
  userId,
  passwordHash,
}: {
  userId: string;
  passwordHash: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.passwordHistory.create({ data: { userId, passwordHash } });

    const rows = await tx.passwordHistory.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (rows.length > PASSWORD_HISTORY_LIMIT) {
      const toDelete = rows.slice(PASSWORD_HISTORY_LIMIT).map((r) => r.id);
      await tx.passwordHistory.deleteMany({ where: { id: { in: toDelete } } });
    }
  });
}
