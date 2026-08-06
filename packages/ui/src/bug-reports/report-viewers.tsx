/**
 * @file Modal viewers for a single bug report's captured detail.
 *
 * Responsibility: the description, console-log, network-log, and screenshot
 *   panels plus the `ReportViewerDialog` shell that titles and swaps between
 *   them. Presentation only — all data arrives via the `report` prop.
 * Gotchas:
 *   - **Console filter**: levels are normalized to lowercase before comparison
 *     so a stored "WARN" matches the "warn" filter chip.
 *   - **Network viewer**: the entries dropdown switches the inner tab back to
 *     "meta" on change so a heavy response body from the previous request
 *     doesn't flash before the user can navigate.
 */

import { useState } from 'react';
import { SegmentedControl } from '../segmented-control';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type { AdminBugReportRow } from './types';
import {
  CONSOLE_LEVELS,
  CONSOLE_LEVEL_BADGE_VARIANT,
  CONSOLE_LEVEL_OPTIONS,
  NETWORK_TABS,
  NETWORK_TAB_OPTIONS,
  formatDateTime,
  getReporterLabel,
  safeJsonParse,
  type ConsoleLogEntry,
  type NetworkLogEntry,
  type ViewerType,
} from './bug-reports-utils';

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
      <SegmentedControl
        size="sm"
        ariaLabel="Filter console logs by level"
        value={levelFilter}
        onValueChange={setLevelFilter}
        options={CONSOLE_LEVEL_OPTIONS}
      />
      <div className="max-h-[55vh] space-y-3 overflow-auto">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
            No console logs captured.
          </div>
        ) : (
          filtered.map((entry, index) => {
            const hasStack = typeof entry.stack === 'string' && entry.stack.length > 0;
            const expanded = expandedStacks[index] ?? false;
            const level = (entry.level ?? 'log').toLowerCase();
            return (
              <div
                key={`${entry.timestamp ?? 'ts'}-${index}`}
                className="rounded-xl border border-border/70 bg-background/60 p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant={CONSOLE_LEVEL_BADGE_VARIANT[level] ?? 'muted'} size="sm" className="uppercase">
                    {entry.level ?? 'log'}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{entry.timestamp ?? '-'}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap wrap-break-word text-foreground">
                  {entry.message ?? ''}
                </p>
                {hasStack ? (
                  <div className="mt-3 space-y-2">
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={() =>
                        setExpandedStacks((current) => ({
                          ...current,
                          [index]: !expanded,
                        }))
                      }
                    >
                      {expanded ? 'Hide stack trace' : 'Show stack trace'}
                    </Button>
                    {expanded ? (
                      <pre className="overflow-auto rounded-md border border-border bg-black/5 p-3 text-xs whitespace-pre-wrap wrap-break-word">
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
          <Select
            value={String(selectedIndex)}
            onValueChange={(value) => {
              setSelectedIndex(Number(value) || 0);
              setTab('meta');
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {entries.map((item, index) => (
                <SelectItem key={`${item.method ?? 'GET'}-${index}`} value={String(index)}>
                  {(item.method ?? 'GET').toUpperCase()} {item.url ?? 'Unknown URL'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SegmentedControl
            size="sm"
            ariaLabel="Network detail view"
            value={tab}
            onValueChange={setTab}
            options={NETWORK_TAB_OPTIONS}
          />
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
          <pre className="whitespace-pre-wrap wrap-break-word text-xs">
            {typeof requestBody === 'string'
              ? requestBody
              : JSON.stringify(requestBody ?? {}, null, 2)}
          </pre>
        ) : tab === 'response' ? (
          <pre className="whitespace-pre-wrap wrap-break-word text-xs">
            {typeof responseBody === 'string'
              ? responseBody
              : JSON.stringify(responseBody ?? {}, null, 2)}
          </pre>
        ) : (
          <div className="space-y-4 text-xs">
            <div>
              <p className="mb-2 text-sm font-medium">Request headers</p>
              <pre className="whitespace-pre-wrap wrap-break-word">
                {JSON.stringify(requestHeaders ?? {}, null, 2)}
              </pre>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Response headers</p>
              <pre className="whitespace-pre-wrap wrap-break-word">
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
        className="inline-flex text-sm text-primary-text underline underline-offset-2"
      >
        Open in new tab
      </a>
    </div>
  );
}

/**
 * Dialog shell that titles the active viewer and renders the matching panel for
 * `report`. `viewerType === null` keeps the dialog closed; `onClose` fires when
 * the user dismisses it.
 */
export function ReportViewerDialog({
  viewerType,
  report,
  onClose,
}: {
  viewerType: ViewerType;
  report: AdminBugReportRow | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={viewerType !== null}
      onOpenChange={(open) => (!open ? onClose() : undefined)}
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
            {report
              ? `${getReporterLabel(report)} • ${formatDateTime(report.createdAt)}`
              : ''}
          </DialogDescription>
        </DialogHeader>
        {report ? (
          viewerType === 'description' ? (
            <DescriptionViewer report={report} />
          ) : viewerType === 'console' ? (
            <ConsoleViewer report={report} />
          ) : viewerType === 'network' ? (
            <NetworkViewer report={report} />
          ) : (
            <ScreenshotViewer report={report} />
          )
        ) : (
          <p className="text-sm text-muted-foreground">Report details unavailable.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
