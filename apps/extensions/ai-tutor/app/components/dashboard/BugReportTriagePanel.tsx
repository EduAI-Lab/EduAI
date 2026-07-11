/**
 * @file "Bug reports to triage" panel — the dashboard's right column for the
 * ADMIN role. Surfaces the newest unhandled reports from
 * `api.listAdminBugReports()`, the same endpoint the `/admin` console uses —
 * no separate/fabricated data source. Mirrors the dashboard hero idiom: a
 * solid warning-fill hero for the most recent report plus a compact list for
 * the rest, so the report awaiting triage reads as the top action.
 */
import { useNavigate } from 'react-router';
import { IconBugOff, IconBug, IconArrowRight } from '@tabler/icons-react';
import { Card, CardContent, courseHeroBackgroundStyle } from '@eduai/ui';
import type { AdminBugReportRow } from '~/lib/types';
import { relativeTime } from './dashboard-helpers';

// Fixed amber fill for the triage hero — bug reports carry no course accent, so
// a warning tone signals "needs review" consistently across light/dark themes.
const TRIAGE_ACCENT = 'oklch(0.62 0.16 55)';
// Darkened accent for the CTA label so text-on-white clears AA contrast.
const CTA_TEXT_COLOR = `color-mix(in oklch, ${TRIAGE_ACCENT} 68%, black)`;

function bugTypeLabel(report: AdminBugReportRow): string {
  return report.bugType?.replace(/_/g, ' ').toLowerCase() ?? 'Report';
}

export function BugReportTriagePanel({ bugReports }: { bugReports: AdminBugReportRow[] }) {
  const navigate = useNavigate();
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

  const [primary, ...others] = unhandled;

  return (
    <div className="flex flex-col gap-3">
      {/* Solid warning-fill hero — the newest report to triage. */}
      <button
        type="button"
        onClick={() => navigate('/admin')}
        style={courseHeroBackgroundStyle(TRIAGE_ACCENT)}
        className="group relative w-full cursor-pointer overflow-hidden rounded-[var(--radius-xl)] p-5 text-left text-white shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div className="relative flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium capitalize text-white ring-1 ring-inset ring-white/20">
              <IconBug size={13} aria-hidden="true" />
              <span className="truncate">{bugTypeLabel(primary)}</span>
            </span>
            <span className="flex-shrink-0 text-xs text-white/70">{relativeTime(primary.createdAt)}</span>
          </div>

          <p className="line-clamp-3 text-sm leading-snug text-white">{primary.description}</p>

          <span
            style={{ color: CTA_TEXT_COLOR }}
            className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-lg)] bg-white px-4 py-2.5 text-sm font-semibold shadow-sm transition-transform group-hover:scale-[1.01]"
          >
            Triage report
            <IconArrowRight size={16} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </button>

      {others.length > 0 && (
        <Card>
          <CardContent className="p-0">
            {others.slice(0, 4).map((report) => (
              <button
                key={report.id}
                type="button"
                onClick={() => navigate('/admin')}
                className="flex w-full cursor-pointer items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/40"
              >
                <span
                  className="mt-0.5 flex size-7 flex-shrink-0 items-center justify-center rounded-full bg-warning-100 text-warning-700"
                  aria-hidden="true"
                >
                  <IconBug size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium capitalize text-muted-foreground">
                      {bugTypeLabel(report)}
                    </span>
                    <span className="flex-shrink-0 text-[11px] text-muted-foreground">
                      {relativeTime(report.createdAt)}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-[13px] leading-snug text-foreground">{report.description}</p>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
