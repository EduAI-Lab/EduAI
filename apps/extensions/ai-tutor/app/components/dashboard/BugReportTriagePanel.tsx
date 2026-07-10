/**
 * @file "Bug reports to triage" panel — the dashboard's right column for the
 * ADMIN role. Lists the most recent unhandled reports from
 * `api.listAdminBugReports()`, the same endpoint the `/admin` console uses —
 * no separate/fabricated data source.
 */
import { Link } from 'react-router';
import { IconBugOff } from '@tabler/icons-react';
import { Card, CardContent } from '@eduai/ui';
import type { AdminBugReportRow } from '~/lib/types';
import { relativeTime } from './dashboard-helpers';

type BugReportTriagePanelProps = {
  bugReports: AdminBugReportRow[];
};

export function BugReportTriagePanel({ bugReports }: BugReportTriagePanelProps) {
  const unhandled = bugReports
    .filter((r) => r.status === 'unhandled')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (unhandled.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <IconBugOff size={20} aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Nothing to triage</p>
            <p className="text-xs text-muted-foreground">No bug reports are waiting for review.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-2xs)]">
      {unhandled.slice(0, 5).map((report) => (
        <Link
          key={report.id}
          to="/admin"
          className="flex flex-col gap-1 border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-muted/40"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {report.bugType?.replace(/_/g, ' ').toLowerCase() ?? 'Report'}
            </span>
            <span className="flex-shrink-0 text-[11px] text-muted-foreground">
              {relativeTime(report.createdAt)}
            </span>
          </div>
          <p className="line-clamp-2 text-[13px] leading-snug text-foreground">
            {report.description}
          </p>
        </Link>
      ))}
    </div>
  );
}
