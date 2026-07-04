import { Prisma, BugReportType } from "@prisma/client";
import prisma from "~/lib/prisma.server";

const VALID_SOURCES = ["CORE", "AI_TUTOR", "QUESTION_MAKER"] as const;
type BugReportSource = (typeof VALID_SOURCES)[number];

const VALID_BUG_TYPES = Object.values(BugReportType);

export type CreateBugReportResult =
  | { ok: true }
  | { ok: false; status: 422; error: "VALIDATION_ERROR"; fields: Record<string, string> }
  | { ok: false; status: 422; error: "USER_NOT_FOUND" };

function validationError(fields: Record<string, string>): CreateBugReportResult {
  return { ok: false, status: 422, error: "VALIDATION_ERROR", fields };
}

export async function createBugReport(raw: unknown): Promise<CreateBugReportResult> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return validationError({ body: "invalid payload" });
  }

  const p = raw as Record<string, unknown>;

  if (!VALID_SOURCES.includes(p.source as BugReportSource)) {
    return validationError({ source: "must be AI_TUTOR or QUESTION_MAKER" });
  }

  if (typeof p.userId !== "string" || p.userId.trim().length === 0) {
    return validationError({ userId: "required string" });
  }

  if (typeof p.description !== "string") {
    return validationError({ description: "required string" });
  }

  if (p.description.length > 2000) {
    return validationError({ description: "exceeds 2000 chars" });
  }

  let bugType: BugReportType | null = null;
  if (p.bugType !== undefined && p.bugType !== null) {
    if (!VALID_BUG_TYPES.includes(p.bugType as BugReportType)) {
      return validationError({ bugType: `must be one of: ${VALID_BUG_TYPES.join(", ")}` });
    }
    bugType = p.bugType as BugReportType;
  }

  const userId = p.userId.trim();

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) {
    return { ok: false, status: 422, error: "USER_NOT_FOUND" };
  }

  await prisma.bugReport.create({
    data: {
      source: p.source as BugReportSource,
      userId,
      description: p.description,
      bugType,
      isAnonymous: typeof p.isAnonymous === "boolean" ? p.isAnonymous : false,
      consoleLogs: typeof p.consoleLogs === "string" ? p.consoleLogs : null,
      networkLogs: typeof p.networkLogs === "string" ? p.networkLogs : null,
      screenshot: typeof p.screenshot === "string" ? p.screenshot : null,
      pageUrl: typeof p.pageUrl === "string" ? p.pageUrl : null,
      userAgent: typeof p.userAgent === "string" ? p.userAgent : null,
      context:
        p.context && typeof p.context === "object" && !Array.isArray(p.context)
          ? (p.context as Prisma.InputJsonValue)
          : Prisma.DbNull,
    },
  });

  return { ok: true };
}

const VALID_STATUSES = ["UNHANDLED", "IN_PROGRESS", "RESOLVED"] as const;
type BugReportStatus = (typeof VALID_STATUSES)[number];

export function isBugReportStatus(value: unknown): value is BugReportStatus {
  return typeof value === "string" && (VALID_STATUSES as readonly string[]).includes(value);
}

const ADMIN_LIST_SOURCES = ["CORE", "AI_TUTOR", "QUESTION_MAKER"] as const;

export function isBugReportSource(value: unknown): value is (typeof ADMIN_LIST_SOURCES)[number] {
  return typeof value === "string" && (ADMIN_LIST_SOURCES as readonly string[]).includes(value);
}

/**
 * GET /api/admin/bug-reports (#304, §11) — admin listing with source/status
 * filters and pagination. When `isAnonymous=true`, the reporter's identity
 * (userId/email/name) is masked in the response — `userId` stays in the DB
 * for audit but never surfaces here.
 */
export async function listBugReports(params: {
  source?: (typeof ADMIN_LIST_SOURCES)[number];
  status?: BugReportStatus;
  limit?: number;
  offset?: number;
}) {
  const { source, status, limit = 50, offset = 0 } = params;
  const clampedLimit = Math.min(Math.max(limit, 1), 200);

  const where = {
    ...(source !== undefined && { source }),
    ...(status !== undefined && { status }),
  };

  const [reports, total] = await Promise.all([
    prisma.bugReport.findMany({
      where,
      include: { user: { select: { email: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: clampedLimit,
      skip: offset,
    }),
    prisma.bugReport.count({ where }),
  ]);

  return {
    reports: reports.map((r) => ({
      id: r.id,
      source: r.source,
      status: r.status,
      description: r.description,
      bugType: r.bugType ?? null,
      isAnonymous: r.isAnonymous,
      // §11 anonymity masking — display-only constraint.
      userId: r.isAnonymous ? null : r.userId,
      userEmail: r.isAnonymous ? null : (r.user?.email ?? null),
      userName: r.isAnonymous ? null : (r.user?.name ?? null),
      consoleLogs: r.consoleLogs,
      networkLogs: r.networkLogs,
      screenshot: r.screenshot,
      pageUrl: r.pageUrl,
      userAgent: r.userAgent,
      context: r.context,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    total,
    limit: clampedLimit,
    offset,
  };
}

/** PATCH /api/admin/bug-reports/:id (#304) — triage status change. */
export async function updateBugReportStatus(id: string, status: BugReportStatus) {
  try {
    return await prisma.bugReport.update({
      where: { id },
      data: { status },
      select: { id: true, status: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return null;
    }
    throw err;
  }
}

/** GET /api/bug-reports?mine=true (#304, §11) — own reports for any user. */
export async function listOwnBugReports(userId: string) {
  return prisma.bugReport.findMany({
    where: { userId },
    select: {
      id: true,
      source: true,
      status: true,
      description: true,
      bugType: true,
      isAnonymous: true,
      pageUrl: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}
