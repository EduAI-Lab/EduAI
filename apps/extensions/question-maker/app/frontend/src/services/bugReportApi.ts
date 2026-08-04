/**
 * Bug report submission and admin listing API.
 */
import api from './api';
import { normalizeAdminBugReportRow, UI_STATUS_TO_CORE } from '@eduai/ui';
import type { AdminBugReportRow, BugReportStatus, RawAdminBugReport } from '@eduai/ui';

export type BugReportType =
  | 'UI_DISPLAY'
  | 'FEATURE_NOT_WORKING'
  | 'PERFORMANCE'
  | 'CONTENT_ERROR'
  | 'ACCESS_PERMISSION'
  | 'OTHER';

/**
 * The admin surface consumes the shared row shape directly — QM's backend is a
 * pure proxy to Core's endpoint, so there is no QM-specific payload to declare.
 */
export type BugReportRow = AdminBugReportRow;

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

/**
 * Core's payload keeps the reporter under `userName`/`userEmail` and the
 * course/module/lesson/activity ids inside the `context` JSON blob, while the
 * shared triage view reads `reporter*` and expects those ids flattened onto the
 * row. `normalizeAdminBugReportRow` does that mapping (status casing included)
 * and is shared with Core's client so the two cannot drift.
 */
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
    return reports.map((row: RawAdminBugReport) => normalizeAdminBugReportRow(row));
  },

  /** Full detail including diagnostic blobs (list rows only carry has* flags). */
  async get(bugId: string): Promise<BugReportRow> {
    const res = await api.get(`/api/admin/bug-reports/${bugId}`);
    return normalizeAdminBugReportRow(res.data.data as RawAdminBugReport);
  },

  async updateStatus(bugId: string, status: string): Promise<void> {
    const coreStatus = UI_STATUS_TO_CORE[status as BugReportStatus] ?? status;
    await api.patch(`/api/admin/bug-reports/${bugId}`, { status: coreStatus });
  },
};
