/**
 * Admin-approved API access for non-admins (#2039).
 *
 * Only active admins may hold API keys by default. An admin can grant a named
 * non-admin (typically a research student) time-boxed access: while the grant
 * is active that user may create their own keys, and those keys work on the
 * routes that opt in (`/api/completion`), within the grant's daily limits.
 * Access ends by itself at `expiresAt`, or at once when an admin revokes it.
 */
import type { ApiAccessGrant } from "@prisma/client";

import prisma from "~/lib/prisma.server";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Defaults an admin starts from when granting access. */
export const DEFAULT_API_ACCESS_DAILY_REQUEST_LIMIT = 200;
export const DEFAULT_API_ACCESS_DAILY_TOKEN_LIMIT = 200_000;

/** Upper bounds an admin can set, so a typo can't grant effectively unlimited use. */
export const MAX_API_ACCESS_DAILY_REQUEST_LIMIT = 5_000;
export const MAX_API_ACCESS_DAILY_TOKEN_LIMIT = 5_000_000;
/** Same ceiling as an API key's own lifetime. */
export const MAX_API_ACCESS_GRANT_DAYS = 365;

/** Limits are counted over the last 24 hours, across all the user's keys. */
export const API_ACCESS_USAGE_WINDOW_MS = DAY_MS;

export type ActiveApiAccessGrant = Pick<
  ApiAccessGrant,
  "id" | "userId" | "expiresAt" | "dailyRequestLimit" | "dailyTokenLimit"
>;

const activeGrantSelect = {
  id: true,
  userId: true,
  expiresAt: true,
  dailyRequestLimit: true,
  dailyTokenLimit: true,
} as const;

/** The user's unrevoked, unexpired grant, or null. */
export async function getActiveApiAccessGrant(
  userId: string | null | undefined,
  now: Date = new Date(),
): Promise<ActiveApiAccessGrant | null> {
  if (!userId) return null;
  return prisma.apiAccessGrant.findFirst({
    where: { userId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { expiresAt: "desc" },
    select: activeGrantSelect,
  });
}

export type ApiUsage = { requests: number; tokens: number };

/**
 * Statuses of requests turned away before reaching a model: over a limit (429)
 * or no slot free (503). They are logged but don't use up the allowance, or a
 * client retrying while limited would keep extending its own lockout.
 */
const UNCOUNTED_STATUSES = [429, 503];

function countedSince(userId: string, since: Date) {
  return { userId, createdAt: { gte: since }, status: { notIn: UNCOUNTED_STATUSES } };
}

/** Requests and tokens the user's keys have used since `since`. */
export async function getApiUsageSince(userId: string, since: Date): Promise<ApiUsage> {
  const usage = await prisma.apiRequestLog.aggregate({
    where: countedSince(userId, since),
    _count: { _all: true },
    _sum: { totalTokens: true },
  });
  return { requests: usage._count._all, tokens: usage._sum.totalTokens ?? 0 };
}

export type ApiAccessLimitResult =
  | { ok: true; usage: ApiUsage }
  | { ok: false; limit: "requests" | "tokens"; usage: ApiUsage; retryAfter: number };

/**
 * When enough of the window's requests (oldest first) have aged out for the
 * user to be back under both limits: past the request limit that is the
 * (requests - limit + 1)th oldest row, past the token limit the row at which
 * the tokens left drop below it. Null if the rows don't get there (they were
 * written between the two reads); the caller then falls back to the oldest.
 */
function freesAtMs(
  rows: ReadonlyArray<{ createdAt: Date; totalTokens: number | null }>,
  usage: ApiUsage,
  grant: ActiveApiAccessGrant,
): number | null {
  let requests = usage.requests;
  let tokens = usage.tokens;
  for (const row of rows) {
    requests -= 1;
    tokens -= row.totalTokens ?? 0;
    if (requests < grant.dailyRequestLimit && tokens < grant.dailyTokenLimit) {
      return row.createdAt.getTime() + API_ACCESS_USAGE_WINDOW_MS;
    }
  }
  return null;
}

/**
 * Whether the grant still has room in its rolling 24-hour window. When it
 * doesn't, `retryAfter` (seconds) is when enough requests have aged out of the
 * window for the user to be under both limits again (#2040 review: it used to
 * be the oldest request alone, which need not free enough tokens).
 */
export async function checkApiAccessLimits(
  grant: ActiveApiAccessGrant,
  now: Date = new Date(),
): Promise<ApiAccessLimitResult> {
  const since = new Date(now.getTime() - API_ACCESS_USAGE_WINDOW_MS);
  const usage = await getApiUsageSince(grant.userId, since);

  let limit: "requests" | "tokens" | null = null;
  if (usage.requests >= grant.dailyRequestLimit) limit = "requests";
  else if (usage.tokens >= grant.dailyTokenLimit) limit = "tokens";
  if (!limit) return { ok: true, usage };

  // At most a limit's worth of rows, and only two columns of each.
  const rows = await prisma.apiRequestLog.findMany({
    where: countedSince(grant.userId, since),
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, totalTokens: true },
  });
  const freesAt =
    freesAtMs(rows, usage, grant) ??
    (rows[0]?.createdAt.getTime() ?? now.getTime()) + API_ACCESS_USAGE_WINDOW_MS;
  const retryAfter = Math.max(1, Math.ceil((freesAt - now.getTime()) / 1000));
  return { ok: false, limit, usage, retryAfter };
}

export class ApiAccessGrantError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = "ApiAccessGrantError";
  }
}

export type CreateApiAccessGrantInput = {
  userId: string;
  grantedById: string;
  purpose: string;
  expiresAt: Date;
  dailyRequestLimit: number;
  dailyTokenLimit: number;
};

/**
 * Give a non-admin API access. Refuses admins (they already have it), inactive
 * accounts, and users who already hold an active grant (edit or revoke that one).
 *
 * The "already has access" check and the insert run in one transaction under a
 * per-user advisory lock, so two concurrent grants (a double-clicked "Give
 * access") can't both pass the check (#2040 review).
 */
export async function createApiAccessGrant(
  input: CreateApiAccessGrantInput,
  now: Date = new Date(),
): Promise<ApiAccessGrant> {
  if (input.expiresAt.getTime() <= now.getTime()) {
    throw new ApiAccessGrantError("The end date must be in the future", 400);
  }
  if (input.expiresAt.getTime() > now.getTime() + MAX_API_ACCESS_GRANT_DAYS * DAY_MS) {
    throw new ApiAccessGrantError(
      `API access can last at most ${MAX_API_ACCESS_GRANT_DAYS} days`,
      400,
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { role: true, isActive: true },
  });
  if (!user) throw new ApiAccessGrantError("User not found", 404);
  if (user.role === "ADMIN") {
    throw new ApiAccessGrantError("Admins already have API access", 400);
  }
  if (!user.isActive) {
    throw new ApiAccessGrantError("This account is deactivated", 400);
  }

  return prisma.$transaction(async (tx) => {
    // Held until the transaction ends. `$executeRaw`, not `$queryRaw`: the lock
    // function returns `void`, which Prisma can't deserialize.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`api-access-grant:${input.userId}`}))`;
    const existing = await tx.apiAccessGrant.findFirst({
      where: { userId: input.userId, revokedAt: null, expiresAt: { gt: now } },
      select: { id: true },
    });
    if (existing) throw new ApiAccessGrantError("This user already has API access", 409);
    return tx.apiAccessGrant.create({ data: input });
  });
}

/**
 * End a grant now. Any other active grant the user holds ends too, so revoking
 * always leaves them without access, and their keys are disabled, so a later
 * grant starts with fresh keys rather than reviving old ones that may have been
 * shared.
 */
export async function revokeApiAccessGrant(
  grantId: string,
  revokedById: string,
  now: Date = new Date(),
): Promise<ApiAccessGrant> {
  const grant = await prisma.apiAccessGrant.findUnique({ where: { id: grantId } });
  if (!grant) throw new ApiAccessGrantError("Grant not found", 404);
  if (grant.revokedAt) return grant;

  const [revoked] = await prisma.$transaction([
    prisma.apiAccessGrant.update({
      where: { id: grantId },
      data: { revokedAt: now, revokedById },
    }),
    prisma.apiAccessGrant.updateMany({
      where: { userId: grant.userId, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now, revokedById },
    }),
    prisma.apikey.updateMany({
      where: { referenceId: grant.userId },
      data: { enabled: false },
    }),
  ]);
  return revoked;
}

export type ApiAccessGrantSummary = ApiAccessGrant & {
  user: { id: string; name: string; email: string; role: string };
  active: boolean;
  usageLast24h: ApiUsage;
};

/** The most grants the admin list returns; revoked and ended ones pile up over terms. */
export const MAX_LISTED_API_ACCESS_GRANTS = 500;

/**
 * Grants for the admin view, newest first, each with its last-24h usage. Usage
 * comes from one grouped query for all the listed users (#2040 review: it was
 * one query per grant).
 */
export async function listApiAccessGrants(
  { includeInactive = false }: { includeInactive?: boolean } = {},
  now: Date = new Date(),
): Promise<ApiAccessGrantSummary[]> {
  const grants = await prisma.apiAccessGrant.findMany({
    where: includeInactive ? {} : { revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    take: MAX_LISTED_API_ACCESS_GRANTS,
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
  });
  if (grants.length === 0) return [];

  const since = new Date(now.getTime() - API_ACCESS_USAGE_WINDOW_MS);
  const userIds = [...new Set(grants.map((grant) => grant.userId))];
  const usageRows = await prisma.apiRequestLog.groupBy({
    by: ["userId"],
    where: {
      userId: { in: userIds },
      createdAt: { gte: since },
      status: { notIn: UNCOUNTED_STATUSES },
    },
    _count: { _all: true },
    _sum: { totalTokens: true },
  });
  const usageBy = new Map(
    usageRows.map((row) => [
      row.userId,
      { requests: row._count._all, tokens: row._sum.totalTokens ?? 0 },
    ]),
  );

  return grants.map((grant) => ({
    ...grant,
    active: grant.revokedAt === null && grant.expiresAt.getTime() > now.getTime(),
    usageLast24h: usageBy.get(grant.userId) ?? { requests: 0, tokens: 0 },
  }));
}
