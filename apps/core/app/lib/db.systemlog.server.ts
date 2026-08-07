/**
 * System-log data access helpers.
 *
 * System logging must never block user-facing mutations. These helpers therefore guarantee
 * a console fallback when DB writes fail so operational diagnostics are still preserved.
 */
import prisma from "~/lib/prisma.server";
import { normalizePagination } from "~/lib/pagination.server";
import {
  redactErrorForConsole,
  redactSecretValuesInString,
  sanitizeSensitiveData,
} from "~/lib/redact.server";

export type SystemLogLevel = "ERROR" | "WARN" | "INFO";

// Keep this union in lockstep with the SystemLogSource enum in prisma/schema.prisma.
export type SystemLogSource = "ROUTE" | "AUTH" | "AI" | "CANVAS" | "MAIL" | "DB" | "SSR" | "API";

export type CreateSystemLogInput = {
  level: SystemLogLevel;
  source: SystemLogSource;
  code: string;
  message: string;
  errorName?: string | null;
  stack?: string | null;
  details?: unknown;
  actorUserId?: string | null;
  actorRole?: string | null;
  requestId?: string | null;
  routePath?: string | null;
  httpMethod?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  statusCode?: number | null;
};

export type CreateSystemErrorInput = Omit<CreateSystemLogInput, "level" | "errorName" | "stack"> & {
  error?: unknown;
};

export type SystemLogListParams = {
  page?: number;
  pageSize?: number;
  level?: SystemLogLevel;
  source?: SystemLogSource;
  code?: string;
  dateFrom?: Date;
  dateTo?: Date;
  sortDirection?: "asc" | "desc";
};

export type SystemLogRow = Awaited<ReturnType<typeof prisma.systemLog.findFirst>>;

function buildSystemLogWhere(params: SystemLogListParams) {
  const where: Record<string, unknown> = {};

  if (params.level) {
    where.level = params.level;
  }
  if (params.source) {
    where.source = params.source;
  }
  if (params.code) {
    where.code = { contains: params.code.trim() };
  }
  if (params.dateFrom || params.dateTo) {
    where.createdAt = {
      ...(params.dateFrom ? { gte: params.dateFrom } : {}),
      ...(params.dateTo ? { lte: params.dateTo } : {}),
    };
  }

  return where;
}

function normalizeErrorMetadata(error: unknown): { errorName: string | null; stack: string | null } {
  // Normalizing unknown errors keeps diagnostics useful even when throwables are non-Error values.
  if (error instanceof Error) {
    return {
      errorName: error.name || "Error",
      stack: error.stack ?? null,
    };
  }

  if (typeof error === "string") {
    return {
      errorName: "Error",
      stack: error,
    };
  }

  return {
    errorName: null,
    stack: null,
  };
}

export async function createSystemLog(input: CreateSystemLogInput): Promise<void> {
  // Redact here rather than in the logging facade: this is the single chokepoint every system
  // log passes through, and `stack` only exists once `normalizeErrorMetadata` has derived it
  // from the thrown value. Error strings routinely embed URLs with `?access_token=` and
  // connection strings with `//user:pass@`.
  //
  // `details` is normally already sanitized by the facade; re-running it covers direct callers.
  // Re-application is idempotent because `[REDACTED]` matches none of the patterns.
  const safeMessage = redactSecretValuesInString(input.message);
  const safeStack = input.stack ? redactSecretValuesInString(input.stack) : null;
  const safeDetails = sanitizeSensitiveData(input.details ?? null);

  try {
    await prisma.systemLog.create({
      data: {
        level: input.level,
        source: input.source,
        code: input.code,
        message: safeMessage,
        errorName: input.errorName ?? null,
        stack: safeStack,
        details: safeDetails as any,
        actorUserId: input.actorUserId ?? null,
        actorRole: input.actorRole ?? null,
        requestId: input.requestId ?? null,
        routePath: input.routePath ?? null,
        httpMethod: input.httpMethod ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        statusCode: input.statusCode ?? null,
      },
    });
  } catch (error) {
    // Console fallback preserves the event even when DB is unhealthy. It must redact too —
    // a connection failure is exactly the case where the driver error carries DB credentials.
    console.error("[SYSTEM_LOG_WRITE_FAILED]", {
      code: input.code,
      source: input.source,
      level: input.level,
      message: safeMessage,
      error: redactErrorForConsole(error),
    });
  }
}

export async function createSystemError(input: CreateSystemErrorInput): Promise<void> {
  const { errorName, stack } = normalizeErrorMetadata(input.error);

  // Dedicated error helper keeps error-level events consistent across all callers.
  await createSystemLog({
    ...input,
    level: "ERROR",
    errorName,
    stack,
  });
}

export async function listSystemLogs(
  params: SystemLogListParams
): Promise<{ rows: SystemLogRow[]; total: number }> {
  const { safePageSize, skip } = normalizePagination(params.page, params.pageSize);
  const where = buildSystemLogWhere(params);

  const [total, rows] = await prisma.$transaction([
    prisma.systemLog.count({ where: where as any }),
    prisma.systemLog.findMany({
      where: where as any,
      include: { user: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: params.sortDirection ?? "desc" },
      skip,
      take: safePageSize,
    }),
  ]);

  return { rows: rows as SystemLogRow[], total };
}

export async function deleteSystemLogsOlderThan(cutoff: Date): Promise<number> {
  // Retention deletes by timestamp only, so newer diagnostics remain fully intact.
  const result = await prisma.systemLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  return result.count;
}

export async function runSystemLogRetention(days = 90): Promise<number> {
  // Guarding against invalid inputs prevents accidental full-table deletion.
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 90;
  const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
  return deleteSystemLogsOlderThan(cutoff);
}
