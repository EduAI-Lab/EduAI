/**
 * Admin logs route.
 *
 * Centralizes Audit / Security / System observability behind admin-only access
 * with URL-driven filters and pagination, plus a DB-backed retention policy.
 */
import { useEffect } from "react";
import { Link, redirect, useActionData, useLoaderData } from "react-router";
import { toast } from "sonner";

import { CoreAppShell } from "~/components/layout/core-app-shell";
import { LogsAdminView, type LogsTab } from "~/components/admin/logs-admin-view";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@eduai/ui";
import { auth } from "~/lib/auth/server";
import {
  listAuditLogs,
  listSecurityLogs,
  runAuditLogRetention,
} from "~/lib/db.auditlog.server";
import { listSystemLogs, runSystemLogRetention } from "~/lib/db.systemlog.server";
import {
  getLogRetentionPolicy,
  runConfiguredLogRetentionIfDue,
  updateLogRetentionPolicy,
} from "~/lib/db.log-retention-policy.server";
import {
  getInteractionCountsByModel,
  getInteractionCountsByServer,
} from "~/lib/db.ai-interaction-stats.server";
import type { Route } from "./+types/admin.logs";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;
const MAX_RETENTION_DAYS = 3650;

// Allow-lists keep URL-supplied enum filters constrained to known values.
const AUDIT_FILTER_CATEGORIES = new Set([
  "USER",
  "INVITATION",
  "COURSE",
  "ENROLLMENT",
  "MATERIAL",
  "TOPIC",
  "AI_CONFIG",
  "CANVAS",
  "BUG_REPORT",
]);
const OUTCOME_VALUES = new Set(["SUCCESS", "FAILURE", "DENIED"]);
const SYSTEM_LEVEL_VALUES = new Set(["ERROR", "WARN", "INFO"]);
const SYSTEM_SOURCE_VALUES = new Set(["ROUTE", "AUTH", "AI", "CANVAS", "MAIL", "DB", "SSR", "API"]);

/** Reject non-admins for both loader and action; returns the session user on success. */
async function requireAdminUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    throw redirect("/auth/login");
  }
  if (session.user.role !== "ADMIN") {
    throw redirect("/dashboard");
  }
  return session.user;
}

/** Trims optional query values so empty strings are treated as "not provided". */
function readOptionalQueryValue(searchParams: URLSearchParams, key: string) {
  const raw = searchParams.get(key);
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

/** Parses positive integer query params with bounded fallback defaults. */
function parsePositiveInt(value: string | null, fallback: number, max: number = Number.MAX_SAFE_INTEGER) {
  if (value === null || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

/** Restricts tab values to known views so unknown query values cannot break rendering. */
function parseLogsTab(value: string | null): LogsTab {
  if (value === "security" || value === "system" || value === "servers") {
    return value;
  }
  return "audit";
}

function parseSortDirection(value: string | null): "asc" | "desc" {
  return value === "asc" ? "asc" : "desc";
}

/** Parses YYYY-MM-DD query values into UTC date boundaries. */
function parseDateFilter(value: string | undefined, mode: "start" | "end") {
  if (!value) {
    return undefined;
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return undefined;
  }
  // Reject out-of-range components (e.g. 2026-13-45). Date.UTC silently rolls these
  // over to a different valid date, which would query a window the admin never asked
  // for — drop the filter instead of returning a wrong one.
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return undefined;
  }
  // Using UTC avoids timezone drift when users filter on day boundaries.
  const boundary =
    mode === "start"
      ? new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
      : new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  // Guard against rollover (e.g. Feb 30 → Mar 2): the round-tripped components must match.
  if (
    boundary.getUTCFullYear() !== year ||
    boundary.getUTCMonth() !== month - 1 ||
    boundary.getUTCDate() !== day
  ) {
    return undefined;
  }
  return boundary;
}

/** Formats a Date as YYYY-MM-DD in UTC, matching what <input type="date"> expects/emits. */
function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Normalizes unknown row payloads into serializable plain objects for the client. */
function serializeRows(rows: unknown[]) {
  return rows.map((row) => {
    const safeRow = (row ?? {}) as Record<string, unknown>;
    const createdAt = safeRow.createdAt;
    return {
      ...safeRow,
      createdAt:
        createdAt instanceof Date
          ? createdAt.toISOString()
          : typeof createdAt === "string"
            ? createdAt
            : "",
    };
  });
}

/** Builds query state returned to the client for URL-preserving tab/filter links. */
function buildQueryState(
  tab: LogsTab,
  page: number,
  pageSize: number,
  direction: "asc" | "desc",
  searchParams: URLSearchParams,
) {
  return {
    tab,
    page: String(page),
    pageSize: String(pageSize),
    direction,
    category: readOptionalQueryValue(searchParams, "category"),
    actionCode: readOptionalQueryValue(searchParams, "actionCode"),
    actorRole: readOptionalQueryValue(searchParams, "actorRole"),
    entityType: readOptionalQueryValue(searchParams, "entityType"),
    outcome: readOptionalQueryValue(searchParams, "outcome"),
    routePath: readOptionalQueryValue(searchParams, "routePath"),
    ipAddress: readOptionalQueryValue(searchParams, "ipAddress"),
    level: readOptionalQueryValue(searchParams, "level"),
    source: readOptionalQueryValue(searchParams, "source"),
    code: readOptionalQueryValue(searchParams, "code"),
    dateFrom: readOptionalQueryValue(searchParams, "dateFrom"),
    dateTo: readOptionalQueryValue(searchParams, "dateTo"),
    // Raw pass-through (not readOptionalQueryValue): "" ("All time") must stay
    // distinguishable from "absent" so the Servers tab dropdown can tell "the
    // admin explicitly chose All time" apart from "first visit, use the
    // 30-day default" — trimming "" to undefined would collapse that.
    datePreset: searchParams.has("datePreset") ? (searchParams.get("datePreset") ?? "") : undefined,
  };
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireAdminUser(request);

  // Periodic sweeps run behind a due-check, so triggering from the loader keeps
  // retention active without a separate scheduler (self-throttles to once/24h).
  void runConfiguredLogRetentionIfDue();

  const retentionPolicy = await getLogRetentionPolicy();

  const url = new URL(request.url);
  const { searchParams } = url;

  const tab = parseLogsTab(searchParams.get("tab"));
  const page = parsePositiveInt(searchParams.get("page"), DEFAULT_PAGE);
  const pageSize = parsePositiveInt(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const direction = parseSortDirection(searchParams.get("direction"));

  const dateFrom = parseDateFilter(readOptionalQueryValue(searchParams, "dateFrom"), "start");
  const dateTo = parseDateFilter(readOptionalQueryValue(searchParams, "dateTo"), "end");

  // The Servers tab aggregates from the fleet registry + live health checks on
  // every request (see db.ai-interaction-stats.server.ts), so an unbounded
  // "all time" default would also aggregate the DB's entire interaction
  // history on first load. Defaulting to the trailing 30 days keeps the first
  // paint fast and matches what the date-range dropdown shows as selected.
  //
  // Resolution order: an explicit dateFrom/dateTo pair (custom range) wins;
  // otherwise a numeric datePreset ("7"/"30"/"90") resolves to "N days ago
  // through now" computed fresh on every request, so "Last 30 days" always
  // means the 30 days ending now rather than a window frozen at first render;
  // datePreset="" means "All time" was explicitly chosen (no bound); absent
  // entirely (first visit, no query params at all) falls back to the 30-day
  // default.
  const datePresetRaw = searchParams.get("datePreset");
  const datePresetDays =
    datePresetRaw !== null && datePresetRaw !== "" && /^\d+$/.test(datePresetRaw)
      ? Number(datePresetRaw)
      : null;
  const hasExplicitDateParams = searchParams.has("dateFrom") || searchParams.has("dateTo");
  const hasAnyDateSelection = hasExplicitDateParams || searchParams.has("datePreset");

  let serversDateFrom = dateFrom;
  let serversDateTo = dateTo;
  if (tab === "servers" && !hasExplicitDateParams) {
    if (datePresetDays !== null) {
      serversDateFrom = new Date(Date.now() - datePresetDays * 24 * 60 * 60 * 1000);
      serversDateTo = new Date();
    } else if (!hasAnyDateSelection) {
      // No params at all — first visit to the tab.
      serversDateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      serversDateTo = new Date();
    }
    // datePreset="" ("All time" explicitly chosen): leave both undefined.
  }

  const sharedReturn = (result: { rows: unknown[]; total: number }) => ({
    user,
    tab,
    page,
    pageSize,
    total: result.total,
    hasMore: page * pageSize < result.total,
    rows: serializeRows(result.rows),
    query: buildQueryState(tab, page, pageSize, direction, searchParams),
    retentionPolicy: {
      auditRetentionDays: retentionPolicy.auditRetentionDays,
      systemRetentionDays: retentionPolicy.systemRetentionDays,
    },
  });

  if (tab === "servers") {
    const [serverStats, modelStats] = await Promise.all([
      getInteractionCountsByServer({ dateFrom: serversDateFrom, dateTo: serversDateTo }),
      getInteractionCountsByModel({ dateFrom: serversDateFrom, dateTo: serversDateTo }),
    ]);
    const query = buildQueryState(tab, page, pageSize, direction, searchParams);
    return {
      user,
      tab,
      page,
      pageSize,
      total: 0,
      hasMore: false,
      rows: [],
      // Reflect the applied default back into the URL-driven query state so the
      // dropdown shows "Last 30 days" selected (rather than appearing blank/
      // "All time") while a 30-day filter is silently applied on first visit.
      query: {
        ...query,
        dateFrom: query.dateFrom ?? (serversDateFrom ? toDateInputValue(serversDateFrom) : undefined),
        dateTo: query.dateTo ?? (serversDateTo ? toDateInputValue(serversDateTo) : undefined),
        datePreset: query.datePreset ?? (!hasAnyDateSelection ? "30" : undefined),
      },
      retentionPolicy: {
        auditRetentionDays: retentionPolicy.auditRetentionDays,
        systemRetentionDays: retentionPolicy.systemRetentionDays,
      },
      serverStats,
      modelStats,
    };
  }

  if (tab === "security") {
    const outcomeRaw = readOptionalQueryValue(searchParams, "outcome");
    const result = await listSecurityLogs({
      page,
      pageSize,
      sortDirection: direction,
      actionCode: readOptionalQueryValue(searchParams, "actionCode"),
      actorRole: readOptionalQueryValue(searchParams, "actorRole"),
      routePath: readOptionalQueryValue(searchParams, "routePath"),
      ipAddress: readOptionalQueryValue(searchParams, "ipAddress"),
      outcome: outcomeRaw && OUTCOME_VALUES.has(outcomeRaw) ? (outcomeRaw as never) : undefined,
      dateFrom,
      dateTo,
    });
    return sharedReturn(result);
  }

  if (tab === "system") {
    const levelRaw = readOptionalQueryValue(searchParams, "level");
    const sourceRaw = readOptionalQueryValue(searchParams, "source");
    const result = await listSystemLogs({
      page,
      pageSize,
      sortDirection: direction,
      level: levelRaw && SYSTEM_LEVEL_VALUES.has(levelRaw) ? (levelRaw as never) : undefined,
      source: sourceRaw && SYSTEM_SOURCE_VALUES.has(sourceRaw) ? (sourceRaw as never) : undefined,
      code: readOptionalQueryValue(searchParams, "code"),
      dateFrom,
      dateTo,
    });
    return sharedReturn(result);
  }

  const categoryRaw = readOptionalQueryValue(searchParams, "category");
  const outcomeRaw = readOptionalQueryValue(searchParams, "outcome");
  const result = await listAuditLogs({
    page,
    pageSize,
    sortDirection: direction,
    category: categoryRaw && AUDIT_FILTER_CATEGORIES.has(categoryRaw) ? (categoryRaw as never) : undefined,
    actionCode: readOptionalQueryValue(searchParams, "actionCode"),
    actorRole: readOptionalQueryValue(searchParams, "actorRole"),
    entityType: readOptionalQueryValue(searchParams, "entityType"),
    routePath: readOptionalQueryValue(searchParams, "routePath"),
    outcome: outcomeRaw && OUTCOME_VALUES.has(outcomeRaw) ? (outcomeRaw as never) : undefined,
    dateFrom,
    dateTo,
  });
  return sharedReturn(result);
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdminUser(request);

  const form = await request.formData();
  const intent = String(form.get("intent") || "").trim();

  if (intent === "updateLogRetentionPolicy") {
    const currentPolicy = await getLogRetentionPolicy();
    // Existing values are fallbacks so partial/blank submissions do not reset unexpectedly.
    const auditRetentionDays = parsePositiveInt(
      form.get("auditRetentionDays") === null ? null : String(form.get("auditRetentionDays")),
      currentPolicy.auditRetentionDays,
      MAX_RETENTION_DAYS,
    );
    const systemRetentionDays = parsePositiveInt(
      form.get("systemRetentionDays") === null ? null : String(form.get("systemRetentionDays")),
      currentPolicy.systemRetentionDays,
      MAX_RETENTION_DAYS,
    );
    await updateLogRetentionPolicy({ auditRetentionDays, systemRetentionDays });
    return {
      success: `Retention policy saved (Audit: ${auditRetentionDays} days, System: ${systemRetentionDays} days).`,
    };
  }

  if (intent === "cleanupAuditLogsNow") {
    const policy = await getLogRetentionPolicy();
    const removed = await runAuditLogRetention(policy.auditRetentionDays);
    return {
      success: `Deleted ${removed} audit log record${removed === 1 ? "" : "s"} older than ${policy.auditRetentionDays} days.`,
    };
  }

  if (intent === "cleanupSystemLogsNow") {
    const policy = await getLogRetentionPolicy();
    const removed = await runSystemLogRetention(policy.systemRetentionDays);
    return {
      success: `Deleted ${removed} system log record${removed === 1 ? "" : "s"} older than ${policy.systemRetentionDays} days.`,
    };
  }

  return { error: "Unknown action." };
}

export default function AdminLogsRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  // Surface action results via the app-wide sonner Toaster (mounted in root.tsx).
  useEffect(() => {
    if (!actionData) return;
    if ("success" in actionData && actionData.success) {
      toast.success(actionData.success);
    } else if ("error" in actionData && actionData.error) {
      toast.error(actionData.error);
    }
  }, [actionData]);

  return (
    <CoreAppShell
      user={data.user}
      breadcrumbs={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/dashboard">Home</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Admin</BreadcrumbPage>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Logs</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    >
      <LogsAdminView
        tab={data.tab}
        rows={data.rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        hasMore={data.hasMore}
        query={data.query}
        retentionPolicy={data.retentionPolicy}
        serverStats={"serverStats" in data ? data.serverStats : undefined}
        modelStats={"modelStats" in data ? data.modelStats : undefined}
      />
    </CoreAppShell>
  );
}
