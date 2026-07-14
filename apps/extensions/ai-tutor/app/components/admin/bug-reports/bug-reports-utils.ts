/**
 * @file Shared types, constants, and pure helpers for the bug-report triage UI.
 *
 * Responsibility: framework-free building blocks used by `BugReportsTab` and its
 *   child components (toolbar, table, viewers) — filter/sort types, status &
 *   type label maps, badge-variant lookups, the reporter/context/path
 *   formatters, the clipboard dossier builder, and the sort comparator.
 * Gotchas:
 *   - **Sort**: `createdAt` sorts as Date timestamps; everything else uses
 *     `String(...).localeCompare` (case-insensitive via locale). Null/undefined
 *     fields fall through to `''` to keep them at the start of asc / end of desc.
 *   - The clipboard helper falls back to a hidden textarea + execCommand for
 *     contexts where `navigator.clipboard` is unavailable (older Safari,
 *     non-secure contexts).
 *   - The copy dossier respects anonymity: identifying fields are omitted
 *     from the raw appendix when `report.isAnonymous` is true.
 */

import type { AdminBugReportRow, BugReportStatus, BugReportType } from '~/lib/types';

export type StatusFilter = BugReportStatus | 'all';
export type TypeFilter = BugReportType | 'all';
export type ReporterFilter = 'all' | 'named' | 'anonymous';

export type SortKey = 'status' | 'description' | 'reporter' | 'role' | 'createdAt' | 'context' | 'page';
export type SortDirection = 'asc' | 'desc';
export type ViewerType = 'description' | 'console' | 'network' | 'screenshot' | null;

export type ConsoleLogEntry = {
  level?: string;
  message?: string;
  timestamp?: string;
  stack?: string;
};

export type NetworkLogEntry = {
  method?: string;
  url?: string;
  status?: number | null;
  durationMs?: number;
  timestamp?: string;
  requestHeaders?: Record<string, string> | null;
  responseHeaders?: Record<string, string> | null;
  requestBody?: unknown;
  responseBody?: unknown;
};

export const STATUS_OPTIONS: BugReportStatus[] = ['unhandled', 'in progress', 'resolved'];
export const STATUS_LABELS: Record<BugReportStatus, string> = {
  unhandled: 'Unhandled',
  'in progress': 'In progress',
  resolved: 'Resolved',
};
// Traffic-light triage semantics: unhandled needs attention (red), in progress
// is underway (amber), resolved is done (green). Drives the Badge rendered
// inside the status Select's trigger.
export const STATUS_BADGE_VARIANT: Record<BugReportStatus, 'destructive' | 'warning' | 'success'> = {
  unhandled: 'destructive',
  'in progress': 'warning',
  resolved: 'success',
};

export const BUG_TYPE_LABELS: Record<BugReportType, string> = {
  UI_DISPLAY: 'UI / display',
  FEATURE_NOT_WORKING: 'Feature not working',
  PERFORMANCE: 'Performance',
  CONTENT_ERROR: 'Content error',
  ACCESS_PERMISSION: 'Access / permission',
  OTHER: 'Other',
};
export const CONSOLE_LEVELS = ['all', 'log', 'warn', 'error'] as const;
export const NETWORK_TABS = ['meta', 'request', 'response', 'headers'] as const;
export const CONSOLE_LEVEL_OPTIONS = CONSOLE_LEVELS.map((level) => ({ value: level, label: level }));
export const NETWORK_TAB_OPTIONS = NETWORK_TABS.map((tab) => ({ value: tab, label: tab }));
export const CONSOLE_LEVEL_BADGE_VARIANT: Record<string, 'destructive' | 'warning' | 'muted'> = {
  error: 'destructive',
  warn: 'warning',
  log: 'muted',
};
export const COPY_FEEDBACK_DURATION_MS = 2_000;

export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function getReporterLabel(report: AdminBugReportRow) {
  if (report.isAnonymous) return 'Anonymous';
  const name = report.reporterName ?? report.userName ?? report.user?.name ?? null;
  const email = report.reporterEmail ?? report.userEmail ?? report.user?.email ?? null;
  if (name && email) return `${name} (${email})`;
  return name ?? email ?? report.userId;
}

export function getReporterRole(report: AdminBugReportRow) {
  return report.reporterRole ?? report.role ?? report.user?.role ?? null;
}

export function getContextLabel(report: AdminBugReportRow) {
  const parts = [
    report.courseTitle,
    report.moduleTitle,
    report.lessonTitle,
    report.activityTitle,
  ].filter(Boolean) as string[];

  if (parts.length > 0) return parts.join(' / ');

  const ids = [
    report.courseOfferingId ? `Course #${report.courseOfferingId}` : null,
    report.moduleId ? `Module #${report.moduleId}` : null,
    report.lessonId ? `Lesson #${report.lessonId}` : null,
    report.activityId ? `Activity #${report.activityId}` : null,
  ].filter(Boolean);

  return ids.length > 0 ? ids.join(' / ') : '-';
}

export function getPathLabel(pageUrl: string | null | undefined) {
  if (!pageUrl) return '-';
  try {
    const url = new URL(pageUrl);
    return url.pathname + url.search;
  } catch {
    return pageUrl;
  }
}

function buildContextSummary(report: AdminBugReportRow) {
  const parts = [
    report.courseTitle ? `Course: ${report.courseTitle}` : null,
    report.moduleTitle ? `Module: ${report.moduleTitle}` : null,
    report.lessonTitle ? `Lesson: ${report.lessonTitle}` : null,
    report.activityTitle ? `Activity: ${report.activityTitle}` : null,
  ].filter(Boolean);

  if (parts.length > 0) {
    return parts;
  }

  return [
    report.courseOfferingId ? `Course ID: ${report.courseOfferingId}` : null,
    report.moduleId ? `Module ID: ${report.moduleId}` : null,
    report.lessonId ? `Lesson ID: ${report.lessonId}` : null,
    report.activityId ? `Activity ID: ${report.activityId}` : null,
  ].filter(Boolean);
}

// Builds the plain-text dossier copied to the clipboard. Honors anonymity by
// omitting reporter name/email (but keeping the internal userId for triage).
export function buildBugReportCopyText(report: AdminBugReportRow) {
  const includeReporterIdentity = !report.isAnonymous;
  const reporterLabel = getReporterLabel(report);
  const reporterRole = getReporterRole(report);
  const contextLines = buildContextSummary(report);
  const parsedConsole = safeJsonParse<ConsoleLogEntry[]>(report.consoleLogs, []);
  const parsedNetwork = safeJsonParse<NetworkLogEntry[]>(report.networkLogs, []);

  const summaryLines = [
    `Bug Report`,
    ``,
    `Summary`,
    `- Report ID: ${report.id}`,
    `- Status: ${report.status}`,
    report.bugType ? `- Type: ${BUG_TYPE_LABELS[report.bugType]}` : null,
    `- Created At: ${formatDateTime(report.createdAt)}`,
    report.updatedAt ? `- Updated At: ${formatDateTime(report.updatedAt)}` : null,
    `- Reporter: ${reporterLabel}`,
    `- Internal User ID: ${report.userId}`,
    reporterRole ? `- Reporter Role: ${reporterRole}` : null,
    report.isAnonymous ? `- Anonymous: yes` : null,
    report.pageUrl ? `- Page URL: ${report.pageUrl}` : null,
    report.userAgent ? `- User Agent: ${report.userAgent}` : null,
    contextLines.length > 0 ? `- Context:` : null,
    ...contextLines.map((line) => `  - ${line}`),
    report.consoleLogs ? `- Console Entries: ${parsedConsole.length}` : null,
    report.networkLogs ? `- Network Entries: ${parsedNetwork.length}` : null,
    report.screenshot ? `- Screenshot: included as data URL in raw appendix` : null,
    ``,
    `Description`,
    report.description,
  ].filter(Boolean);

  const rawAppendix: Record<string, unknown> = {
    id: report.id,
    status: report.status,
    description: report.description,
    userId: report.userId,
    isAnonymous: report.isAnonymous,
  };

  if (report.createdAt) rawAppendix.createdAt = report.createdAt;
  if (report.updatedAt) rawAppendix.updatedAt = report.updatedAt;
  if (includeReporterIdentity && report.reporterName)
    rawAppendix.reporterName = report.reporterName;
  if (includeReporterIdentity && report.reporterEmail)
    rawAppendix.reporterEmail = report.reporterEmail;
  if (reporterRole) rawAppendix.reporterRole = reporterRole;
  if (report.pageUrl) rawAppendix.pageUrl = report.pageUrl;
  if (report.userAgent) rawAppendix.userAgent = report.userAgent;
  if (report.courseOfferingId !== null && report.courseOfferingId !== undefined) {
    rawAppendix.courseOfferingId = report.courseOfferingId;
  }
  if (report.moduleId !== null && report.moduleId !== undefined) {
    rawAppendix.moduleId = report.moduleId;
  }
  if (report.lessonId !== null && report.lessonId !== undefined) {
    rawAppendix.lessonId = report.lessonId;
  }
  if (report.activityId !== null && report.activityId !== undefined) {
    rawAppendix.activityId = report.activityId;
  }
  if (report.courseTitle) rawAppendix.courseTitle = report.courseTitle;
  if (report.moduleTitle) rawAppendix.moduleTitle = report.moduleTitle;
  if (report.lessonTitle) rawAppendix.lessonTitle = report.lessonTitle;
  if (report.activityTitle) rawAppendix.activityTitle = report.activityTitle;
  if (report.consoleLogs) rawAppendix.consoleLogs = report.consoleLogs;
  if (report.networkLogs) rawAppendix.networkLogs = report.networkLogs;
  if (report.screenshot) rawAppendix.screenshot = report.screenshot;

  return `${summaryLines.join('\n')}\n\nRaw Appendix\n${JSON.stringify(rawAppendix, null, 2)}`;
}

export async function copyTextToClipboard(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard is not available');
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    const copied = document.execCommand('copy');
    if (!copied) {
      throw new Error('Clipboard copy failed');
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

// Generic sort across heterogeneous columns. Date column compares by epoch
// (so "11" sorts after "2"); other columns use locale-aware string compare
// to give case-insensitive ordering. Null/undefined coerce to '' (top of asc).
export function sortReports(rows: AdminBugReportRow[], key: SortKey, direction: SortDirection) {
  const dir = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av =
      key === 'status'
        ? a.status
        : key === 'description'
          ? a.description
          : key === 'reporter'
            ? getReporterLabel(a)
            : key === 'role'
              ? (getReporterRole(a) ?? '')
              : key === 'context'
                ? getContextLabel(a)
                : key === 'page'
                  ? getPathLabel(a.pageUrl)
                  : a.createdAt;
    const bv =
      key === 'status'
        ? b.status
        : key === 'description'
          ? b.description
          : key === 'reporter'
            ? getReporterLabel(b)
            : key === 'role'
              ? (getReporterRole(b) ?? '')
              : key === 'context'
                ? getContextLabel(b)
                : key === 'page'
                  ? getPathLabel(b.pageUrl)
                  : b.createdAt;

    if (key === 'createdAt') {
      const at = new Date(av).getTime();
      const bt = new Date(bv).getTime();
      if (at === bt) return 0;
      return at > bt ? dir : -dir;
    }

    return String(av).localeCompare(String(bv)) * dir;
  });
}
