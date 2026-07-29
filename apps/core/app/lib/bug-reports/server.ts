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
  /** Dropped (not truncated) when oversized — truncating base64 corrupts the image. */
  screenshot: 512_000,
  pageUrl: 2048,
  userAgent: 512,
  contextJson: 8_192,
} as const;

export type CreateBugReportResult =
  | { ok: true; report: { id: string } }
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

/**
 * Context is diagnostic garnish — never fail the whole submission over it.
 * Oversized or non-serializable context is dropped to DbNull so the
 * description and logs still persist (#1116 review).
 */
function prepareContext(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  // Non-object / array context was previously coerced to DbNull — keep that behavior.
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Prisma.DbNull;
  }

  const sanitized = sanitizeSensitiveData(value);
  let serialized: string;
  try {
    serialized = JSON.stringify(sanitized);
  } catch {
    return Prisma.DbNull;
  }

  if (serialized.length > BUG_REPORT_FIELD_LIMITS.contextJson) {
    return Prisma.DbNull;
  }

  return sanitized as Prisma.InputJsonValue;
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

  // Oversized screenshot is dropped, not rejected: truncating a data URL yields
  // a broken image, and failing the submit would lose the description + logs
  // with it (full-page captures trip the cap easily — #1116 review).
  // Empty strings are stored as null so has* flags stay consistent.
  const screenshotValue =
    typeof p.screenshot === "string" &&
    p.screenshot.length > 0 &&
    p.screenshot.length <= BUG_REPORT_FIELD_LIMITS.screenshot
      ? p.screenshot
      : null;

  const pageUrl = optionalCappedString(p.pageUrl, BUG_REPORT_FIELD_LIMITS.pageUrl);
  if (!pageUrl.ok) {
    return validationError({ pageUrl: pageUrl.reason });
  }

  const userAgent = optionalCappedString(p.userAgent, BUG_REPORT_FIELD_LIMITS.userAgent);
  if (!userAgent.ok) {
    return validationError({ userAgent: userAgent.reason });
  }

  const context = prepareContext(p.context);

  const userId = p.userId.trim();

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) {
    return { ok: false, status: 422, error: "USER_NOT_FOUND" };
  }

  const report = await prisma.bugReport.create({
    data: {
      source: p.source as BugReportSource,
      userId,
      description: p.description,
      bugType,
      isAnonymous: typeof p.isAnonymous === "boolean" ? p.isAnonymous : false,
      consoleLogs: consoleLogs.value,
      networkLogs: networkLogs.value,
      screenshot: screenshotValue,
      pageUrl: pageUrl.value,
      userAgent: userAgent.value,
      context,
    },
  });

  return { ok: true, report: { id: report.id } };
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

function maskReporter(r: {
  isAnonymous: boolean;
  userId: string | null;
  userEmail?: string | null;
  userName?: string | null;
  user?: { email: string | null; name: string | null } | null;
}) {
  const email = r.userEmail ?? r.user?.email ?? null;
  const name = r.userName ?? r.user?.name ?? null;
  return {
    userId: r.isAnonymous ? null : r.userId,
    userEmail: r.isAnonymous ? null : email,
    userName: r.isAnonymous ? null : name,
  };
}

/** Non-empty attachment presence — matches AI Tutor / QM mappers (`!= null && !== ''`). */
function hasAttachment(value: string | null | undefined): boolean {
  return value != null && value !== "";
}

type ListBugReportRow = {
  id: string;
  source: string;
  status: string;
  description: string;
  bugType: string | null;
  isAnonymous: boolean;
  userId: string | null;
  pageUrl: string | null;
  userAgent: string | null;
  context: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
  hasConsoleLogs: boolean;
  hasNetworkLogs: boolean;
  hasScreenshot: boolean;
  userEmail: string | null;
  userName: string | null;
};

/**
 * GET /api/admin/bug-reports (#304, §11) — admin listing with source/status
 * filters and pagination. Heavy diagnostic blobs are omitted from the list
 * payload (#979); use {@link getBugReportById} when a viewer needs them.
 * When `isAnonymous=true`, the reporter's identity is masked in the response.
 *
 * Presence flags are computed in the same query (`IS NOT NULL AND <> ''`) so
 * we do not pay a second round-trip or load TEXT blobs into the Node heap.
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

  const conditions: Prisma.Sql[] = [];
  if (source !== undefined) {
    conditions.push(Prisma.sql`br.source = ${source}::"BugReportSource"`);
  }
  if (status !== undefined) {
    conditions.push(Prisma.sql`br.status = ${status}::"BugReportStatus"`);
  }
  const whereSql =
    conditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
      : Prisma.sql``;

  const [reports, total] = await Promise.all([
    prisma.$queryRaw<ListBugReportRow[]>`
      SELECT
        br.id,
        br.source::text AS source,
        br.status::text AS status,
        br.description,
        br."bugType"::text AS "bugType",
        br."isAnonymous",
        br."userId",
        br."pageUrl",
        br."userAgent",
        br.context,
        br."createdAt",
        br."updatedAt",
        (br."consoleLogs" IS NOT NULL AND br."consoleLogs" <> '') AS "hasConsoleLogs",
        (br."networkLogs" IS NOT NULL AND br."networkLogs" <> '') AS "hasNetworkLogs",
        (br.screenshot IS NOT NULL AND br.screenshot <> '') AS "hasScreenshot",
        u.email AS "userEmail",
        u.name AS "userName"
      FROM bug_reports br
      LEFT JOIN "user" u ON u.id = br."userId"
      ${whereSql}
      ORDER BY br."createdAt" DESC
      LIMIT ${clampedLimit}
      OFFSET ${offset}
    `,
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
      ...maskReporter(r),
      // Bodies omitted from list; flags drive UI enablement. Full blobs via getBugReportById.
      consoleLogs: null as string | null,
      networkLogs: null as string | null,
      screenshot: null as string | null,
      hasConsoleLogs: Boolean(r.hasConsoleLogs),
      hasNetworkLogs: Boolean(r.hasNetworkLogs),
      hasScreenshot: Boolean(r.hasScreenshot),
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
    // Presence means non-empty — matches the list SQL flags and the AI Tutor /
    // QM mappers (`!= null && !== ''`) so viewers never open on an empty blob.
    hasConsoleLogs: hasAttachment(r.consoleLogs),
    hasNetworkLogs: hasAttachment(r.networkLogs),
    hasScreenshot: hasAttachment(r.screenshot),
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
