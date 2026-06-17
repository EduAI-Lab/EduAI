/**
 * Bug report submission API — triage lives in EduAI Core (/admin/bug-reports).
 */
import api from './api';

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
};
