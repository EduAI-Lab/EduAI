/**
 * @file Admin triage table for incoming bug reports.
 *
 * Responsibility: Sortable table view of all reports plus modal viewers for
 *   the description, captured console logs, captured network logs, and
 *   screenshot. Lets admins move each report through status (unhandled →
 *   in progress → resolved) and copy a self-contained text dossier.
 * Used by: `app/routes/admin.tsx` as one tab of the admin dashboard.
 * Gotchas:
 *   - **Anonymous reports**: when a reporter checks "submit anonymously",
 *     the server in `server/src/utils/bugReportMappers.js` strips identifying
 *     fields. This component only RENDERS; the masking is server-side. The
 *     `getReporterLabel` helper still falls through to the userId so admins
 *     can correlate without seeing the name/email.
 *   - **Sort**: `createdAt` sorts as Date timestamps; everything else uses
 *     `String(...).localeCompare` (case-insensitive via locale). Null/undefined
 *     fields fall through to `''` to keep them at the start of asc / end of desc.
 *   - **Console filter**: levels are normalized to lowercase before comparison
 *     so a stored "WARN" matches the "warn" filter chip.
 *   - **Network viewer**: the entries dropdown switches the inner tab back to
 *     "meta" on change so a heavy response body from the previous request
 *     doesn't flash before the user can navigate.
 *   - The clipboard helper falls back to a hidden textarea + execCommand for
 *     contexts where `navigator.clipboard` is unavailable (older Safari,
 *     non-secure contexts).
 *   - The copy dossier respects anonymity: identifying fields are omitted
 *     from the raw appendix when `report.isAnonymous` is true.
 * Related: `server/src/routes/admin.js` (PATCH bug-report endpoint),
 *   `server/src/utils/bugReportMappers.js` (anonymity masking),
 *   `app/components/bug-report/BugReportDialog.tsx` (capture-side counterpart)
 */

import { useMemo, useState } from 'react';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import api from '~/lib/api';
import type { AdminBugReportRow, BugReportStatus } from '~/lib/types';

type SortKey = 'status' | 'description' | 'reporter' | 'role' | 'createdAt' | 'context' | 'page';
type SortDirection = 'asc' | 'desc';
type ViewerType = 'description' | 'console' | 'network' | 'screenshot' | null;

type ConsoleLogEntry = {
  level?: string;
  message?: string;
  timestamp?: string;
  stack?: string;
};

type NetworkLogEntry = {
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

const STATUS_OPTIONS: BugReportStatus[] = ['unhandled', 'in progress', 'resolved'];
const CONSOLE_LEVELS = ['all', 'log', 'warn', 'error'] as const;
const NETWORK_TABS = ['meta', 'request', 'response', 'headers'] as const;
const COPY_FEEDBACK_DURATION_MS = 2_000;

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function getReporterLabel(report: AdminBugReportRow) {
  if (report.isAnonymous) return 'Anonymous';
  const name = report.reporterName ?? report.userName ?? report.user?.name ?? null;
  const email = report.reporterEmail ?? report.userEmail ?? report.user?.email ?? null;
  if (name && email) return `${name} (${email})`;
  return name ?? email ?? report.userId;
}

function getReporterRole(report: AdminBugReportRow) {
  return report.reporterRole ?? report.role ?? report.user?.role ?? null;
}

function getContextLabel(report: AdminBugReportRow) {
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

function getPathLabel(pageUrl: string | null | undefined) {
  if (!pageUrl) return '-';
  try {
    const url = new URL(pageUrl);
    return url.pathname + url.search;
  } catch {
    return pageUrl;
  }
}

function getStatusClasses(status: BugReportStatus) {
  if (status === 'resolved') return 'bg-green-500/10 text-green-700 dark:text-green-400';
  if (status === 'in progress') return 'bg-amber-500/10 text-amber-700 dark:text-amber-400';
  return 'bg-red-500/10 text-red-700 dark:text-red-400';
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
function buildBugReportCopyText(report: AdminBugReportRow) {
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

async function copyTextToClipboard(text: string) {
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
function sortReports(rows: AdminBugReportRow[], key: SortKey, direction: SortDirection) {
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

function SortHeader({
  title,
  sortKey,
  activeSortKey,
  direction,
  onToggle,
}: {
  title: string;
  sortKey: SortKey;
  activeSortKey: SortKey;
  direction: SortDirection;
  onToggle: (key: SortKey) => void;
}) {
  const isActive = sortKey === activeSortKey;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      onClick={() => onToggle(sortKey)}
    >
      <span>{title}</span>
      <span aria-hidden="true">{isActive ? (direction === 'asc' ? '▲' : '▼') : '↕'}</span>
    </button>
  );
}

function DescriptionViewer({ report }: { report: AdminBugReportRow }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">Reported by {getReporterLabel(report)}</p>
      <div className="max-h-[55vh] overflow-auto rounded-xl border border-border/70 bg-background/60 p-4 whitespace-pre-wrap">
        {report.description}
      </div>
    </div>
  );
}

// Modal panel for browsing captured console output. Filter chips narrow by level;
// stack traces are collapsed by default to keep the list scannable.
function ConsoleViewer({ report }: { report: AdminBugReportRow }) {
  const entries = safeJsonParse<ConsoleLogEntry[]>(report.consoleLogs, []);
  const [levelFilter, setLevelFilter] = useState<(typeof CONSOLE_LEVELS)[number]>('all');
  const [expandedStacks, setExpandedStacks] = useState<Record<number, boolean>>({});

  const filtered = entries.filter((entry) => {
    if (levelFilter === 'all') return true;
    // Normalize stored level casing so "WARN"/"Warn"/"warn" all match the chip.
    return (entry.level ?? 'log').toLowerCase() === levelFilter;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {CONSOLE_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => setLevelFilter(level)}
            className={`rounded-md border px-2 py-1 text-xs ${
              levelFilter === level
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground'
            }`}
          >
            {level}
          </button>
        ))}
      </div>
      <div className="max-h-[55vh] space-y-3 overflow-auto">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
            No console logs captured.
          </div>
        ) : (
          filtered.map((entry, index) => {
            const hasStack = typeof entry.stack === 'string' && entry.stack.length > 0;
            const expanded = expandedStacks[index] ?? false;
            return (
              <div
                key={`${entry.timestamp ?? 'ts'}-${index}`}
                className="rounded-xl border border-border/70 bg-background/60 p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium uppercase text-xs text-muted-foreground">
                    {entry.level ?? 'log'}
                  </span>
                  <span className="text-xs text-muted-foreground">{entry.timestamp ?? '-'}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-foreground">
                  {entry.message ?? ''}
                </p>
                {hasStack ? (
                  <div className="mt-3 space-y-2">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedStacks((current) => ({
                          ...current,
                          [index]: !expanded,
                        }))
                      }
                      className="text-xs text-primary underline underline-offset-2"
                    >
                      {expanded ? 'Hide stack trace' : 'Show stack trace'}
                    </button>
                    {expanded ? (
                      <pre className="overflow-auto rounded-md border border-border bg-black/5 p-3 text-xs whitespace-pre-wrap break-words">
                        {entry.stack}
                      </pre>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// Modal panel for browsing captured network entries. The inner tab resets to
// "meta" when a different request is selected so heavy bodies don't flash.
function NetworkViewer({ report }: { report: AdminBugReportRow }) {
  const entries = safeJsonParse<NetworkLogEntry[]>(report.networkLogs, []);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [tab, setTab] = useState<(typeof NETWORK_TABS)[number]>('meta');

  const entry = entries[selectedIndex] ?? null;
  const requestBody = entry?.requestBody;
  const responseBody = entry?.responseBody;
  const requestHeaders = entry?.requestHeaders;
  const responseHeaders = entry?.responseHeaders;

  return (
    <div className="space-y-4">
      {entries.length > 0 ? (
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Request
          </label>
          <select
            className="input-field text-sm"
            value={selectedIndex}
            onChange={(event) => {
              setSelectedIndex(Number(event.target.value) || 0);
              setTab('meta');
            }}
          >
            {entries.map((item, index) => (
              <option key={`${item.method ?? 'GET'}-${index}`} value={index}>
                {(item.method ?? 'GET').toUpperCase()} {item.url ?? 'Unknown URL'}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap items-center gap-2">
            {NETWORK_TABS.map((itemTab) => (
              <button
                key={itemTab}
                type="button"
                onClick={() => setTab(itemTab)}
                className={`rounded-md border px-2 py-1 text-xs ${
                  tab === itemTab
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background text-muted-foreground'
                }`}
              >
                {itemTab}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="max-h-[55vh] overflow-auto rounded-xl border border-border/70 bg-background/60 p-4 text-sm">
        {!entry ? (
          <span className="text-muted-foreground">No network logs captured.</span>
        ) : tab === 'meta' ? (
          <div className="space-y-2">
            <div>
              <span className="font-medium">Method:</span> {(entry.method ?? 'GET').toUpperCase()}
            </div>
            <div>
              <span className="font-medium">URL:</span> {entry.url ?? '-'}
            </div>
            <div>
              <span className="font-medium">Status:</span> {entry.status ?? '-'}
            </div>
            <div>
              <span className="font-medium">Duration:</span> {entry.durationMs ?? '-'}ms
            </div>
            <div>
              <span className="font-medium">Timestamp:</span> {entry.timestamp ?? '-'}
            </div>
          </div>
        ) : tab === 'request' ? (
          <pre className="whitespace-pre-wrap break-words text-xs">
            {typeof requestBody === 'string'
              ? requestBody
              : JSON.stringify(requestBody ?? {}, null, 2)}
          </pre>
        ) : tab === 'response' ? (
          <pre className="whitespace-pre-wrap break-words text-xs">
            {typeof responseBody === 'string'
              ? responseBody
              : JSON.stringify(responseBody ?? {}, null, 2)}
          </pre>
        ) : (
          <div className="space-y-4 text-xs">
            <div>
              <p className="mb-2 text-sm font-medium">Request headers</p>
              <pre className="whitespace-pre-wrap break-words">
                {JSON.stringify(requestHeaders ?? {}, null, 2)}
              </pre>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Response headers</p>
              <pre className="whitespace-pre-wrap break-words">
                {JSON.stringify(responseHeaders ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScreenshotViewer({ report }: { report: AdminBugReportRow }) {
  if (!report.screenshot) {
    return <p className="text-sm text-muted-foreground">No screenshot captured.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="max-h-[55vh] overflow-auto rounded-xl border border-border/70 bg-background/60 p-2">
        <img
          src={report.screenshot}
          alt="Bug report screenshot"
          className="w-full rounded-md border"
        />
      </div>
      <a
        href={report.screenshot}
        target="_blank"
        rel="noreferrer"
        className="inline-flex text-sm text-primary underline underline-offset-2"
      >
        Open in new tab
      </a>
    </div>
  );
}

/**
 * Top-level table component. `initialReports` is provided by the admin route
 * loader; subsequent mutations (status PATCH) update the local list optimistically.
 */
export default function BugReportsTab({ initialReports }: { initialReports: AdminBugReportRow[] }) {
  const [reports, setReports] = useState<AdminBugReportRow[]>(initialReports);
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [updatingReportId, setUpdatingReportId] = useState<string | null>(null);
  const [copiedReportId, setCopiedReportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewerType, setViewerType] = useState<ViewerType>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);

  const sortedReports = useMemo(
    () => sortReports(reports, sortKey, sortDirection),
    [reports, sortDirection, sortKey],
  );

  const selectedReport =
    selectedReportId === null
      ? null
      : (reports.find((report) => report.id === selectedReportId) ?? null);

  const toggleSort = (nextSortKey: SortKey) => {
    if (sortKey === nextSortKey) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    // Date defaults to descending (newest first); everything else to ascending (A-Z).
    setSortKey(nextSortKey);
    setSortDirection(nextSortKey === 'createdAt' ? 'desc' : 'asc');
  };

  const openViewer = (type: Exclude<ViewerType, null>, reportId: string) => {
    setSelectedReportId(reportId);
    setViewerType(type);
  };

  const closeViewer = () => {
    setViewerType(null);
    setSelectedReportId(null);
  };

  const onStatusChange = async (reportId: string, status: BugReportStatus) => {
    setError(null);
    setUpdatingReportId(reportId);
    try {
      const updated = await api.updateAdminBugReportStatus(reportId, { status });
      setReports((current) =>
        current.map((report) => (report.id === reportId ? { ...report, ...updated } : report)),
      );
    } catch {
      setError('Could not update bug report status. Please try again.');
    } finally {
      setUpdatingReportId(null);
    }
  };

  const onCopyReport = async (report: AdminBugReportRow) => {
    setError(null);
    try {
      await copyTextToClipboard(buildBugReportCopyText(report));
      setCopiedReportId(report.id);
      window.setTimeout(() => {
        setCopiedReportId((current) => (current === report.id ? null : current));
      }, COPY_FEEDBACK_DURATION_MS);
    } catch {
      setError('Could not copy bug report details. Please try again.');
      setCopiedReportId((current) => (current === report.id ? null : current));
    }
  };

  return (
    <div className="card-editorial p-6 sm:p-8 space-y-6 animate-fade-up delay-150">
      <div className="space-y-2">
        <h2 className="font-display text-xl font-bold text-foreground">Bug Reports</h2>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Review incoming reports from students and professors, inspect captured diagnostics, and
          move each report through triage status.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card/80">
        <table className="w-full min-w-[1080px] border-collapse">
          <thead className="border-b border-border/70 bg-muted/30">
            <tr>
              <th className="px-3 py-3 text-left">
                <SortHeader
                  title="Status"
                  sortKey="status"
                  activeSortKey={sortKey}
                  direction={sortDirection}
                  onToggle={toggleSort}
                />
              </th>
              <th className="px-3 py-3 text-left">
                <SortHeader
                  title="Description"
                  sortKey="description"
                  activeSortKey={sortKey}
                  direction={sortDirection}
                  onToggle={toggleSort}
                />
              </th>
              <th className="px-3 py-3 text-left">
                <SortHeader
                  title="Reporter"
                  sortKey="reporter"
                  activeSortKey={sortKey}
                  direction={sortDirection}
                  onToggle={toggleSort}
                />
              </th>
              <th className="px-3 py-3 text-left">
                <SortHeader
                  title="Role"
                  sortKey="role"
                  activeSortKey={sortKey}
                  direction={sortDirection}
                  onToggle={toggleSort}
                />
              </th>
              <th className="px-3 py-3 text-left">
                <SortHeader
                  title="Date"
                  sortKey="createdAt"
                  activeSortKey={sortKey}
                  direction={sortDirection}
                  onToggle={toggleSort}
                />
              </th>
              <th className="px-3 py-3 text-left">
                <SortHeader
                  title="Context"
                  sortKey="context"
                  activeSortKey={sortKey}
                  direction={sortDirection}
                  onToggle={toggleSort}
                />
              </th>
              <th className="px-3 py-3 text-left">
                <SortHeader
                  title="Page"
                  sortKey="page"
                  activeSortKey={sortKey}
                  direction={sortDirection}
                  onToggle={toggleSort}
                />
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Attachments
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedReports.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No bug reports yet.
                </td>
              </tr>
            ) : (
              sortedReports.map((report) => (
                <tr key={report.id} className="border-b border-border/50 align-top last:border-b-0">
                  <td className="px-3 py-3">
                    <div className="space-y-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getStatusClasses(report.status)}`}
                      >
                        {report.status}
                      </span>
                      <select
                        aria-label={`Update status for report ${report.id}`}
                        className="input-field h-8 text-xs"
                        value={report.status}
                        onChange={(event) =>
                          onStatusChange(report.id, event.target.value as BugReportStatus)
                        }
                        disabled={updatingReportId === report.id}
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className="max-w-[320px] px-3 py-3 text-sm">
                    <button
                      type="button"
                      className="truncate text-left text-foreground hover:text-primary"
                      title={report.description}
                      onClick={() => openViewer('description', report.id)}
                    >
                      {report.description}
                    </button>
                  </td>
                  <td className="max-w-[220px] px-3 py-3 text-sm text-foreground">
                    {report.isAnonymous ? (
                      <span className="italic text-muted-foreground">Anonymous</span>
                    ) : (
                      getReporterLabel(report)
                    )}
                  </td>
                  <td className="px-3 py-3 text-sm text-muted-foreground">
                    {getReporterRole(report) ?? '-'}
                  </td>
                  <td className="px-3 py-3 text-sm text-muted-foreground">
                    {formatDateTime(report.createdAt)}
                  </td>
                  <td className="max-w-[260px] px-3 py-3 text-sm text-muted-foreground">
                    <span title={getContextLabel(report)}>{getContextLabel(report)}</span>
                  </td>
                  <td className="max-w-[220px] px-3 py-3 text-sm text-muted-foreground">
                    <span title={report.pageUrl ?? ''}>{getPathLabel(report.pageUrl)}</span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={copiedReportId === report.id ? 'secondary' : 'outline'}
                        onClick={() => onCopyReport(report)}
                      >
                        {copiedReportId === report.id ? 'Copied!' : 'Copy'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => openViewer('console', report.id)}
                        disabled={!report.consoleLogs}
                      >
                        Console
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => openViewer('network', report.id)}
                        disabled={!report.networkLogs}
                      >
                        Network
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => openViewer('screenshot', report.id)}
                        disabled={!report.screenshot}
                      >
                        Screenshot
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog
        open={viewerType !== null}
        onOpenChange={(open) => (!open ? closeViewer() : undefined)}
      >
        <DialogContent className="max-w-4xl p-6">
          <DialogHeader>
            <DialogTitle>
              {viewerType === 'description'
                ? 'Report Description'
                : viewerType === 'console'
                  ? 'Console Logs'
                  : viewerType === 'network'
                    ? 'Network Logs'
                    : 'Screenshot'}
            </DialogTitle>
            <DialogDescription>
              {selectedReport
                ? `${getReporterLabel(selectedReport)} • ${formatDateTime(selectedReport.createdAt)}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {selectedReport ? (
            viewerType === 'description' ? (
              <DescriptionViewer report={selectedReport} />
            ) : viewerType === 'console' ? (
              <ConsoleViewer report={selectedReport} />
            ) : viewerType === 'network' ? (
              <NetworkViewer report={selectedReport} />
            ) : (
              <ScreenshotViewer report={selectedReport} />
            )
          ) : (
            <p className="text-sm text-muted-foreground">Report details unavailable.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
