import { Prisma, BugReportType } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import {
  redactDiagnosticLogString,
  sanitizeSensitiveData,
} from "~/lib/redact.server";

const VALID_SOURCES = ["CORE", "AI_TUTOR", "QUESTION_MAKER"] as const;
type BugReportSource = (typeof VALID_SOURCES)[number];

const VALID_BUG_TYPES = Object.values(BugReportType);

/** Field size caps (#979) — bound storage and admin-list payload amplification. */
export const BUG_REPORT_FIELD_LIMITS = {
  description: 2000,
  consoleLogs: 100_000,
  networkLogs: 100_000,
  /** Reject (do not truncate) — truncating base64 corrupts the image. */
  screenshot: 512_000,
  pageUrl: 2048,
  userAgent: 512,
  contextJson: 8_192,
} as const;

export type CreateBugReportResult =
  | { ok: true }
  | { ok: false; status: 422; error: "VALIDATION_ERROR"; fields: Record<string, string> }
  | { ok: false; status: 422; error: "USER_NOT_FOUND" };

function validationError(fields: Record<string, string>): CreateBugReportResult {
  return { ok: false, status: 422, error: "VALIDATION_ERROR", fields };
}

/**
 * Optional string fields: non-strings are ignored (null), oversized values rejected.
 * Matches prior createBugReport coercion while adding #979 size caps.
 */
function optionalCappedString(
  value: unknown,
  maxChars: number,
): { ok: true; value: string | null } | { ok: false; reason: string } {
  if (typeof value !== "string") {
    return { ok: true, value: null };
  }
  if (value.length > maxChars) {
    return { ok: false, reason: `exceeds ${maxChars} chars` };
  }
  return { ok: true, value };
}

/**
 * Redact then truncate diagnostic log blobs. Truncation is safe for triage text;
 * secrets must be scrubbed first so a cut mid-token cannot leave a partial secret.
 */
function prepareDiagnosticLogs(
  value: unknown,
  maxChars: number,
): { ok: true; value: string | null } {
  if (typeof value !== "string") {
    return { ok: true, value: null };
  }
  const redacted = redactDiagnosticLogString(value);
  return {
    ok: true,
    value: redacted.length > maxChars ? redacted.slice(0, maxChars) : redacted,
  };
}

function prepareContext(
  value: unknown,
):
  | { ok: true; value: Prisma.InputJsonValue | typeof Prisma.DbNull }
  | { ok: false; reason: string } {
  // Non-object / array context was previously coerced to DbNull — keep that behavior.
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: true, value: Prisma.DbNull };
  }

  const sanitized = sanitizeSensitiveData(value);
  let serialized: string;
  try {
    serialized = JSON.stringify(sanitized);
  } catch {
    return { ok: false, reason: "must be JSON-serializable" };
  }

  if (serialized.length > BUG_REPORT_FIELD_LIMITS.contextJson) {
    return {
      ok: false,
      reason: `exceeds ${BUG_REPORT_FIELD_LIMITS.contextJson} chars when serialized`,
    };
  }

  return { ok: true, value: sanitized as Prisma.InputJsonValue };
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

  if (p.description.length > BUG_REPORT_FIELD_LIMITS.description) {
    return validationError({
      description: `exceeds ${BUG_REPORT_FIELD_LIMITS.description} chars`,
    });
  }

  let bugType: BugReportType | null = null;
  if (p.bugType !== undefined && p.bugType !== null) {
    if (!VALID_BUG_TYPES.includes(p.bugType as BugReportType)) {
      return validationError({ bugType: `must be one of: ${VALID_BUG_TYPES.join(", ")}` });
    }
    bugType = p.bugType as BugReportType;
  }

  const consoleLogs = prepareDiagnosticLogs(
    p.consoleLogs,
    BUG_REPORT_FIELD_LIMITS.consoleLogs,
  );
  const networkLogs = prepareDiagnosticLogs(
    p.networkLogs,
    BUG_REPORT_FIELD_LIMITS.networkLogs,
  );

  // Screenshot is rejected when oversized — truncating a data URL yields a broken image.
  const screenshot = optionalCappedString(p.screenshot, BUG_REPORT_FIELD_LIMITS.screenshot);
  if (!screenshot.ok) {
    return validationError({ screenshot: screenshot.reason });
  }

  const pageUrl = optionalCappedString(p.pageUrl, BUG_REPORT_FIELD_LIMITS.pageUrl);
  if (!pageUrl.ok) {
    return validationError({ pageUrl: pageUrl.reason });
  }

  const userAgent = optionalCappedString(p.userAgent, BUG_REPORT_FIELD_LIMITS.userAgent);
  if (!userAgent.ok) {
    return validationError({ userAgent: userAgent.reason });
  }

  const context = prepareContext(p.context);
  if (!context.ok) {
    return validationError({ context: context.reason });
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
      consoleLogs: consoleLogs.value,
      networkLogs: networkLogs.value,
      screenshot: screenshot.value,
      pageUrl: pageUrl.value,
      userAgent: userAgent.value,
      context: context.value,
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

type AttachmentFlags = {
  hasConsoleLogs: boolean;
  hasNetworkLogs: boolean;
  hasScreenshot: boolean;
};

/**
 * Presence flags without loading TEXT blobs into the Node heap (#979 list DoS).
 */
async function loadAttachmentFlags(ids: string[]): Promise<Map<string, AttachmentFlags>> {
  const map = new Map<string, AttachmentFlags>();
  if (ids.length === 0) return map;

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      hasConsoleLogs: boolean;
      hasNetworkLogs: boolean;
      hasScreenshot: boolean;
    }>
  >`
    SELECT
      id,
      ("consoleLogs" IS NOT NULL) AS "hasConsoleLogs",
      ("networkLogs" IS NOT NULL) AS "hasNetworkLogs",
      (screenshot IS NOT NULL) AS "hasScreenshot"
    FROM bug_reports
    WHERE id IN (${Prisma.join(ids)})
  `;

  for (const row of rows) {
    map.set(row.id, {
      hasConsoleLogs: Boolean(row.hasConsoleLogs),
      hasNetworkLogs: Boolean(row.hasNetworkLogs),
      hasScreenshot: Boolean(row.hasScreenshot),
    });
  }
  return map;
}

function maskReporter<T extends {
  isAnonymous: boolean;
  userId: string | null;
  user: { email: string | null; name: string | null } | null;
}>(r: T) {
  return {
    userId: r.isAnonymous ? null : r.userId,
    userEmail: r.isAnonymous ? null : (r.user?.email ?? null),
    userName: r.isAnonymous ? null : (r.user?.name ?? null),
  };
}

/**
 * GET /api/admin/bug-reports (#304, §11) — admin listing with source/status
 * filters and pagination. Heavy diagnostic blobs are omitted from the list
 * payload (#979); use {@link getBugReportById} when a viewer needs them.
 * When `isAnonymous=true`, the reporter's identity is masked in the response.
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
      // Exclude consoleLogs / networkLogs / screenshot — loading them for up to
      // 200 rows is how admin list amplified storage DoS into response DoS (#979).
      select: {
        id: true,
        source: true,
        status: true,
        description: true,
        bugType: true,
        isAnonymous: true,
        userId: true,
        pageUrl: true,
        userAgent: true,
        context: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { email: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: clampedLimit,
      skip: offset,
    }),
    prisma.bugReport.count({ where }),
  ]);

  const flagsById = await loadAttachmentFlags(reports.map((r) => r.id));

  return {
    reports: reports.map((r) => {
      const flags = flagsById.get(r.id) ?? {
        hasConsoleLogs: false,
        hasNetworkLogs: false,
        hasScreenshot: false,
      };
      return {
        id: r.id,
        source: r.source,
        status: r.status,
        description: r.description,
        bugType: r.bugType ?? null,
        isAnonymous: r.isAnonymous,
        ...maskReporter(r),
        // Bodies omitted from list; flags drive UI enablement. Full blobs via getBugReportById.
        consoleLogs: null as string | null,
        networkLogs: null as string | null,
        screenshot: null as string | null,
        hasConsoleLogs: flags.hasConsoleLogs,
        hasNetworkLogs: flags.hasNetworkLogs,
        hasScreenshot: flags.hasScreenshot,
        pageUrl: r.pageUrl,
        userAgent: r.userAgent,
        context: r.context,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    }),
    total,
    limit: clampedLimit,
    offset,
  };
}

/** GET /api/admin/bug-reports/:id — full report including diagnostic blobs. */
export async function getBugReportById(id: string) {
  const r = await prisma.bugReport.findUnique({
    where: { id },
    include: { user: { select: { email: true, name: true } } },
  });
  if (!r) return null;

  return {
    id: r.id,
    source: r.source,
    status: r.status,
    description: r.description,
    bugType: r.bugType ?? null,
    isAnonymous: r.isAnonymous,
    ...maskReporter(r),
    consoleLogs: r.consoleLogs,
    networkLogs: r.networkLogs,
    screenshot: r.screenshot,
    hasConsoleLogs: r.consoleLogs != null,
    hasNetworkLogs: r.networkLogs != null,
    hasScreenshot: r.screenshot != null,
    pageUrl: r.pageUrl,
    userAgent: r.userAgent,
    context: r.context,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
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
