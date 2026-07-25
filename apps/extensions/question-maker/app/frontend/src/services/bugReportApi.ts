/**
 * Bug report submission and admin listing API.
 */
import api from './api';
import { toUiStatus, UI_STATUS_TO_CORE } from '@eduai/ui';
import type { BugReportStatus } from '@eduai/ui';

export type BugReportType =
  | 'UI_DISPLAY'
  | 'FEATURE_NOT_WORKING'
  | 'PERFORMANCE'
  | 'CONTENT_ERROR'
  | 'ACCESS_PERMISSION'
  | 'OTHER';

export interface BugReportRow {
  id: string;
  description: string;
  bugType: BugReportType | null;
  status: string;
  source?: string;
  consoleLogs: string | null;
  networkLogs: string | null;
  screenshot: string | null;
  pageUrl: string | null;
  userAgent: string | null;
  isAnonymous: boolean;
  user?: { email: string };
  createdAt: string;
}

export interface SubmitBugReportPayload {
  description: string;
  bugType: BugReportType | null;
  consoleLogs: string;
  networkLogs: string;
  screenshot: string | null;
  pageUrl: string;
  userAgent: string;
  isAnonymous: boolean;
}

function mapCoreReport(report: Record<string, unknown>): BugReportRow {
  const status = String(report.status ?? 'UNHANDLED');
  return {
    id: String(report.id),
    description: String(report.description ?? ''),
    bugType: (report.bugType as BugReportType | null) ?? null,
    status: toUiStatus(status),
    source: report.source != null ? String(report.source) : undefined,
    consoleLogs: (report.consoleLogs as string | null) ?? null,
    networkLogs: (report.networkLogs as string | null) ?? null,
    screenshot: (report.screenshot as string | null) ?? null,
    pageUrl: (report.pageUrl as string | null) ?? null,
    userAgent: (report.userAgent as string | null) ?? null,
    isAnonymous: Boolean(report.isAnonymous),
    user:
      report.userEmail != null
        ? { email: String(report.userEmail) }
        : undefined,
    createdAt: String(report.createdAt ?? new Date().toISOString()),
  };
}

export const bugReportApi = {
  async submit(payload: SubmitBugReportPayload): Promise<{ id: number }> {
    const res = await api.post('/api/bug-reports', payload);
    return res.data.data;
  },

  async list(options?: { source?: string; limit?: number }): Promise<BugReportRow[]> {
    const params: Record<string, string | number> = { limit: options?.limit ?? 100 };
    if (options?.source) {
      params.source = options.source;
    }
    const res = await api.get('/api/admin/bug-reports', { params });
    const payload = res.data.data;
    const reports = Array.isArray(payload?.reports) ? payload.reports : [];
    return reports.map((row: Record<string, unknown>) => mapCoreReport(row));
  },

  async updateStatus(bugId: string, status: string): Promise<void> {
    const coreStatus = UI_STATUS_TO_CORE[status as BugReportStatus] ?? status;
    await api.patch(`/api/admin/bug-reports/${bugId}`, { status: coreStatus });
  },
};
