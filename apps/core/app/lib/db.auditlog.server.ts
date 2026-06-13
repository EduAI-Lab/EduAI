/**
 * Audit-log data access helpers.
 *
 * These helpers isolate storage/query rules so route actions can log accountability events
 * without duplicating pagination, filtering, and security-category conventions.
 */
import prisma from "~/lib/prisma.server";

// Keep this union in lockstep with the AuditLogCategory enum in prisma/schema.prisma.
export type AuditLogCategory =
  | "USER"
  | "INVITATION"
  | "COURSE"
  | "ENROLLMENT"
  | "MATERIAL"
  | "TOPIC"
  | "AI_CONFIG"
  | "CANVAS"
  | "BUG_REPORT"
  | "SECURITY";

export type AuditLogOutcome = "SUCCESS" | "FAILURE" | "DENIED";

export type CreateAuditLogInput = {
  actionCode: string;
  category: AuditLogCategory;
  outcome?: AuditLogOutcome;
  actorUserId?: string | null;
  actorRole?: string | null;
  actorType?: string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  details?: unknown;
  requestId?: string | null;
  routePath?: string | null;
  httpMethod?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type AuditLogListParams = {
  page?: number;
  pageSize?: number;
  category?: AuditLogCategory;
  actionCode?: string;
  actorRole?: string;
  actorUserId?: string;
  entityType?: string;
  entityId?: string;
  routePath?: string;
  ipAddress?: string;
  outcome?: AuditLogOutcome;
  dateFrom?: Date;
  dateTo?: Date;
  sortDirection?: "asc" | "desc";
  includeSecurity?: boolean;
};

export type SecurityLogListParams = Omit<AuditLogListParams, "category" | "includeSecurity">;

export type AuditLogRow = Awaited<ReturnType<typeof prisma.auditLog.findFirst>>;

function normalizePagination(page = 1, pageSize = 25) {
  // Clamping avoids pathological query sizes while preserving URL-driven paging behavior.
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const safePageSize = Number.isFinite(pageSize)
    ? Math.min(200, Math.max(1, Math.floor(pageSize)))
    : 25;
  return {
    safePage,
    safePageSize,
    skip: (safePage - 1) * safePageSize,
  };
}

function buildAuditLogWhere(
  params: AuditLogListParams,
  opts: { forceSecurityCategory: boolean }
) {
  const where: Record<string, unknown> = {};

  // Security tab queries are always hard-scoped to SECURITY so caller mistakes cannot leak tabs.
  if (opts.forceSecurityCategory) {
    where.category = "SECURITY";
  } else if (params.category) {
    where.category = params.category;
  } else if (!params.includeSecurity) {
    where.category = { not: "SECURITY" };
  }

  if (params.actionCode) {
    where.actionCode = { contains: params.actionCode.trim() };
  }
  if (params.actorRole) {
    where.actorRole = params.actorRole.trim();
  }
  if (params.actorUserId) {
    where.actorUserId = params.actorUserId.trim();
  }
  if (params.entityType) {
    where.entityType = params.entityType.trim();
  }
  if (params.entityId) {
    where.entityId = params.entityId.trim();
  }
  if (params.routePath) {
    where.routePath = { contains: params.routePath.trim() };
  }
  if (params.ipAddress) {
    // IP filters are required by security triage views to narrow suspicious traffic patterns quickly.
    where.ipAddress = { contains: params.ipAddress.trim() };
  }
  if (params.outcome) {
    where.outcome = params.outcome;
  }

  if (params.dateFrom || params.dateTo) {
    where.createdAt = {
      ...(params.dateFrom ? { gte: params.dateFrom } : {}),
      ...(params.dateTo ? { lte: params.dateTo } : {}),
    };
  }

  return where;
}

export async function createAuditLog(input: CreateAuditLogInput): Promise<void> {
  // Defaults are applied server-side to keep call sites concise and consistent.
  await prisma.auditLog.create({
    data: {
      actionCode: input.actionCode,
      category: input.category,
      outcome: input.outcome ?? "SUCCESS",
      actorUserId: input.actorUserId ?? null,
      actorRole: input.actorRole ?? null,
      actorType: input.actorType ?? "USER",
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      entityLabel: input.entityLabel ?? null,
      details: (input.details ?? null) as any,
      requestId: input.requestId ?? null,
      routePath: input.routePath ?? null,
      httpMethod: input.httpMethod ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

export async function createSecurityLog(
  input: Omit<CreateAuditLogInput, "category"> & { actionCode: string }
): Promise<void> {
  // SECURITY is enforced here so callers cannot accidentally misclassify auth/abuse telemetry.
  await createAuditLog({
    ...input,
    category: "SECURITY",
  });
}

export async function listAuditLogs(
  params: AuditLogListParams
): Promise<{ rows: AuditLogRow[]; total: number }> {
  const { safePageSize, skip } = normalizePagination(params.page, params.pageSize);
  const where = buildAuditLogWhere(params, { forceSecurityCategory: false });

  // Count and page query are executed together to keep pagination metadata consistent.
  const [total, rows] = await prisma.$transaction([
    prisma.auditLog.count({ where: where as any }),
    prisma.auditLog.findMany({
      where: where as any,
      include: { user: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: params.sortDirection ?? "desc" },
      skip,
      take: safePageSize,
    }),
  ]);

  return { rows: rows as AuditLogRow[], total };
}

export async function listSecurityLogs(
  params: SecurityLogListParams
): Promise<{ rows: AuditLogRow[]; total: number }> {
  const { safePageSize, skip } = normalizePagination(params.page, params.pageSize);
  const where = buildAuditLogWhere(params, { forceSecurityCategory: true });

  const [total, rows] = await prisma.$transaction([
    prisma.auditLog.count({ where: where as any }),
    prisma.auditLog.findMany({
      where: where as any,
      include: { user: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: params.sortDirection ?? "desc" },
      skip,
      take: safePageSize,
    }),
  ]);

  return { rows: rows as AuditLogRow[], total };
}

export async function getAuditLogById(id: string): Promise<AuditLogRow | null> {
  // Detail views need actor context to explain who performed each operation.
  const row = await prisma.auditLog.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true, role: true } } },
  });

  return row as AuditLogRow | null;
}

export async function deleteAuditLogsOlderThan(cutoff: Date): Promise<number> {
  // Timestamp-only deletion keeps recent accountability history queryable for active investigations.
  const result = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  return result.count;
}

export async function runAuditLogRetention(days = 365): Promise<number> {
  // Guarding invalid values prevents accidental broad deletion from malformed admin inputs.
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 365;
  const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
  return deleteAuditLogsOlderThan(cutoff);
}
