/**
 * Bug report submission and admin listing API.
 */
import api from './api';

export interface BugReportRow {
  id: number;
  description: string;
  status: string;
  consoleLogs: string | null;
  networkLogs: string | null;
  screenshot: string | null;
  pageUrl: string | null;
  userAgent: string | null;
  isAnonymous: boolean;
  userId: number;
  user: { email: string };
  createdAt: string;
}

export interface SubmitBugReportPayload {
  description: string;
  consoleLogs: string;
  networkLogs: string;
  screenshot: string | null;
  pageUrl: string;
  userAgent: string;
  isAnonymous: boolean;
}

export const bugReportApi = {
  async submit(payload: SubmitBugReportPayload): Promise<{ id: number }> {
    const res = await api.post('/api/bug-reports', payload);
    return res.data.data;
  },

  async list(): Promise<BugReportRow[]> {
    const res = await api.get('/api/bug-reports');
    return res.data.data;
  },

  async updateStatus(bugId: number, status: string): Promise<void> {
    await api.patch(`/api/bug-reports/${bugId}`, { status });
  }
};
