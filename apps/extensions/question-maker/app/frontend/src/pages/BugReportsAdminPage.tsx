/**
 * Question Maker's bug-report triage page.
 *
 * The table, filter bar, viewers, and sorting live in `@eduai/ui`
 * (`BugReportsAdminView`) — this file is only QM's data wiring and RBAC gate.
 * QM's backend is a pure proxy to Core's admin endpoint that pins
 * `source=QUESTION_MAKER`, so the rows are the same shape every app sees.
 *
 * List vs detail (#979): list rows omit the console/network/screenshot bodies
 * and carry only `has*` flags, so `onLoadDetail` hands the shared view a
 * fetcher for the per-report detail endpoint.
 */
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { BugReportsAdminView, PageHeading } from '@eduai/ui';
import type { AdminBugReportRow, BugReportStatus } from '@eduai/ui';
import { toast } from 'sonner';

import { bugReportApi } from '../services/bugReportApi';
import { useAuth } from '../contexts/AuthContext';
import { canTriageBugReports } from '@/lib/rbac';

const QM_SOURCE = 'QUESTION_MAKER' as const;

export function BugReportsAdminPage() {
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();
  const [rows, setRows] = useState<AdminBugReportRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      // `bugReportApi` already normalises Core's payload into the shared row
      // shape (reporter fields, flattened context, UI status casing).
      setRows(await bugReportApi.list({ source: QM_SOURCE }));
    } catch {
      toast.error('Could not load bug reports', { description: 'You may not have admin access.' });
      navigate('/home');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    if (isLoading) return;
    const qmUser = user
      ? { id: user.id, role: user.role, authorizedUnits: user.authorizedUnits }
      : null;
    if (!canTriageBugReports(qmUser)) {
      navigate('/home', { replace: true });
      return;
    }
    void load();
  }, [isLoading, user, navigate, load]);

  if (isLoading) return null;
  const qmUser = user
    ? { id: user.id, role: user.role, authorizedUnits: user.authorizedUnits }
    : null;
  if (!canTriageBugReports(qmUser)) return null;

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-4 md:py-6 lg:px-6">
      <PageHeading heading="Bug reports" subheading="Triage Question Maker bug reports." />

      <BugReportsAdminView
        reports={rows}
        isLoading={loading}
        title="All reports"
        onUpdateStatus={async (reportId: string, status: BugReportStatus) => {
          await bugReportApi.updateStatus(reportId, status);
        }}
        onLoadDetail={(reportId: string) => bugReportApi.get(reportId)}
      />
    </div>
  );
}
