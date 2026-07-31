/**
 * @file AI Tutor's bug-report triage tab.
 *
 * The table, filter bar, viewers, and sorting now live in `@eduai/ui`
 * (`BugReportsAdminView`) — this file is only the AI Tutor data wiring for it.
 * All three apps read the same `bug_reports` table through the same Core
 * endpoint; this app's server is a proxy that pins `source=AI_TUTOR`.
 *
 * Anonymity masking stays server-side in `server/src/utils/bugReportMappers.js`.
 *
 * List vs detail (#979): list rows omit the console/network/screenshot bodies
 * and carry only `has*` flags, so `onLoadDetail` below hands the shared view a
 * fetcher for `GET /api/admin/bug-reports/:id`.
 */
import { BugReportsAdminView } from '@eduai/ui';
import type { AdminBugReportRow, BugReportStatus } from '@eduai/ui';

import api from '~/lib/api';

export default function BugReportsTab({ initialReports }: { initialReports: AdminBugReportRow[] }) {
  return (
    <BugReportsAdminView
      className="animate-fade-up delay-150"
      reports={initialReports}
      description="Review AI Tutor bug reports."
      onUpdateStatus={(reportId: string, status: BugReportStatus) =>
        api.updateAdminBugReportStatus(reportId, { status })
      }
      onLoadDetail={(reportId: string) => api.getAdminBugReport(reportId)}
    />
  );
}
