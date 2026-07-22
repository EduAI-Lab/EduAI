/**
 * Bug report submission and admin listing API.
 */
import api from './api';

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
  /** List rows omit blobs (#979); flags say whether detail fetch will return them. */
  hasConsoleLogs?: boolean;
  hasNetworkLogs?: boolean;
  hasScreenshot?: boolean;
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

const CORE_TO_UI_STATUS: Record<string, string> = {
  UNHANDLED: 'unhandled',
  IN_PROGRESS: 'in progress',
  RESOLVED: 'resolved',
};

const UI_TO_CORE_STATUS: Record<string, string> = {
  unhandled: 'UNHANDLED',
  'in progress': 'IN_PROGRESS',
  resolved: 'RESOLVED',
};

function mapCoreReport(report: Record<string, unknown>): BugReportRow {
  const status = String(report.status ?? 'UNHANDLED');
  const consoleLogs = (report.consoleLogs as string | null) ?? null;
  const networkLogs = (report.networkLogs as string | null) ?? null;
  const screenshot = (report.screenshot as string | null) ?? null;
  return {
    id: String(report.id),
    description: String(report.description ?? ''),
    bugType: (report.bugType as BugReportType | null) ?? null,
    status: CORE_TO_UI_STATUS[status] ?? status.toLowerCase(),
    source: report.source != null ? String(report.source) : undefined,
    consoleLogs,
    networkLogs,
    screenshot,
    hasConsoleLogs:
      typeof report.hasConsoleLogs === 'boolean'
        ? report.hasConsoleLogs
        : Boolean(consoleLogs),
    hasNetworkLogs:
      typeof report.hasNetworkLogs === 'boolean'
        ? report.hasNetworkLogs
        : Boolean(networkLogs),
    hasScreenshot:
      typeof report.hasScreenshot === 'boolean'
        ? report.hasScreenshot
        : Boolean(screenshot),
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

  /** Full detail including diagnostic blobs (list rows only carry has* flags). */
  async get(bugId: string): Promise<BugReportRow> {
    const res = await api.get(`/api/admin/bug-reports/${bugId}`);
    return mapCoreReport(res.data.data as Record<string, unknown>);
  },

  async updateStatus(bugId: string, status: string): Promise<void> {
    const coreStatus = UI_TO_CORE_STATUS[status] ?? status.toUpperCase().replace(' ', '_');
    await api.patch(`/api/admin/bug-reports/${bugId}`, { status: coreStatus });
  },
};
