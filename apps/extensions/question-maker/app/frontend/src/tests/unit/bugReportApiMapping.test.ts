/**
 * QM's admin bug-report client hands rows straight to the shared
 * `BugReportsAdminView`, so the mapping has to produce a *real*
 * `AdminBugReportRow` — not a cast over QM's narrower payload. A cast used to
 * hide three dropped fields: `userId` (the copy dossier printed
 * `Internal User ID: undefined`), `updatedAt`, and the flattened `context` ids
 * the context column reads.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildBugReportCopyText, getContextLabel, getReporterLabel } from '@eduai/ui';

const get = vi.fn();
const patch = vi.fn();

vi.mock('../../services/api', () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
    patch: (...args: unknown[]) => patch(...args),
    post: vi.fn(),
  },
}));

const { bugReportApi } = await import('../../services/bugReportApi');

/** A Core list row as QM's proxy passes it through, blobs omitted (#979). */
const CORE_ROW = {
  id: 'br-7',
  source: 'QUESTION_MAKER',
  status: 'IN_PROGRESS',
  description: 'Variant export drops the last section',
  bugType: 'FEATURE_NOT_WORKING',
  isAnonymous: false,
  userId: 'user-42',
  userName: 'Alex Patel',
  userEmail: 'alex@eduai.test',
  pageUrl: 'https://qm.eduai.test/courses/7/assessments',
  userAgent: 'Mozilla/5.0',
  consoleLogs: null,
  networkLogs: null,
  screenshot: null,
  hasConsoleLogs: true,
  hasNetworkLogs: false,
  hasScreenshot: false,
  context: { courseOfferingId: 7, moduleId: 3 },
  createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: '2026-05-02T11:30:00.000Z',
};

describe('bugReportApi admin mapping', () => {
  beforeEach(() => {
    get.mockReset();
    patch.mockReset();
  });

  it('scopes the list request to Question Maker reports', async () => {
    get.mockResolvedValue({ data: { data: { reports: [] } } });

    await bugReportApi.list({ source: 'QUESTION_MAKER' });

    expect(get).toHaveBeenCalledWith('/api/admin/bug-reports', {
      params: { limit: 100, source: 'QUESTION_MAKER' },
    });
  });

  it('returns rows the shared view can read in full', async () => {
    get.mockResolvedValue({ data: { data: { reports: [CORE_ROW] } } });

    const [row] = await bugReportApi.list({ source: 'QUESTION_MAKER' });

    expect(row.userId).toBe('user-42');
    expect(row.updatedAt).toBe('2026-05-02T11:30:00.000Z');
    expect(row.reporterName).toBe('Alex Patel');
    expect(row.reporterEmail).toBe('alex@eduai.test');
    expect(getReporterLabel(row)).toBe('Alex Patel (alex@eduai.test)');
    // Core's enum is lower-cased for the shared status Select.
    expect(row.status).toBe('in progress');
  });

  it('flattens the context blob instead of leaving the column empty', async () => {
    get.mockResolvedValue({ data: { data: { reports: [CORE_ROW] } } });

    const [row] = await bugReportApi.list({ source: 'QUESTION_MAKER' });

    expect(row.courseOfferingId).toBe(7);
    expect(row.moduleId).toBe(3);
    expect(getContextLabel(row)).toBe('Course #7 / Module #3');
  });

  it('never copies an undefined internal user id', async () => {
    get.mockResolvedValue({ data: { data: { reports: [CORE_ROW] } } });

    const [row] = await bugReportApi.list({ source: 'QUESTION_MAKER' });

    expect(buildBugReportCopyText(row)).toContain('Internal User ID: user-42');
    expect(buildBugReportCopyText(row)).not.toContain('undefined');
  });

  it('tolerates a response with no reports array', async () => {
    get.mockResolvedValue({ data: { data: {} } });

    await expect(bugReportApi.list()).resolves.toEqual([]);
  });

  it('maps the detail payload the same way, keeping the diagnostic blobs', async () => {
    // The detail endpoint sends the bodies and derives its flags from them.
    get.mockResolvedValue({
      data: {
        data: {
          ...CORE_ROW,
          consoleLogs: '[{"level":"error","message":"boom"}]',
          networkLogs: '[]',
          screenshot: 'data:image/png;base64,AAA',
          hasConsoleLogs: true,
          hasNetworkLogs: true,
          hasScreenshot: true,
        },
      },
    });

    const row = await bugReportApi.get('br-7');

    expect(get).toHaveBeenCalledWith('/api/admin/bug-reports/br-7');
    expect(row.userId).toBe('user-42');
    expect(row.courseOfferingId).toBe(7);
    expect(row.hasConsoleLogs).toBe(true);
    expect(row.hasScreenshot).toBe(true);
    // '[]' parses to an empty array but is still a body — flag mirrors the payload.
    expect(row.networkLogs).toBe('[]');
  });

  it('masks the reporter on anonymous reports', async () => {
    get.mockResolvedValue({
      data: { data: { reports: [{ ...CORE_ROW, isAnonymous: true }] } },
    });

    const [row] = await bugReportApi.list({ source: 'QUESTION_MAKER' });

    expect(getReporterLabel(row)).toBe('Anonymous');
    expect(row.reporterEmail).toBeNull();
    expect(buildBugReportCopyText(row)).not.toContain('alex@eduai.test');
  });

  it('sends Core’s status enum on update, not the UI casing', async () => {
    patch.mockResolvedValue({ data: {} });

    await bugReportApi.updateStatus('br-7', 'in progress');

    expect(patch).toHaveBeenCalledWith('/api/admin/bug-reports/br-7', {
      status: 'IN_PROGRESS',
    });
  });
});
