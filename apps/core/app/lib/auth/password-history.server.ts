import prisma from "~/lib/prisma.server";

export const PASSWORD_HISTORY_LIMIT = 10;

type VerifyFn = (data: { password: string; hash: string }) => Promise<boolean>;

/**
 * Returns true if `candidate` matches any of the user's last
 * PASSWORD_HISTORY_LIMIT stored hashes OR their current credential password.
 * Uses the injected `verify` so the caller controls the hash algorithm
 * (typically `ctx.context.password.verify` from better-auth).
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
 * Appends the new hash to the user's password history and prunes any rows
 * beyond PASSWORD_HISTORY_LIMIT, keeping only the most recent ones.
 */
export async function recordPasswordHistory({
  userId,
  passwordHash,
}: {
  userId: string;
  passwordHash: string;
}): Promise<void> {
  await prisma.passwordHistory.create({ data: { userId, passwordHash } });

  // Count existing rows; delete oldest if over the limit
  const rows = await prisma.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (rows.length > PASSWORD_HISTORY_LIMIT) {
    const toDelete = rows.slice(PASSWORD_HISTORY_LIMIT).map((r) => r.id);
    await prisma.passwordHistory.deleteMany({ where: { id: { in: toDelete } } });
  }
}
