import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

class MockBugReportError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const mockCreateBugReport = vi.fn();
const mockGetAdminBugReport = vi.fn();
const mockListAdminBugReports = vi.fn();
const mockUpdateBugReportStatus = vi.fn();
const mockGetEduAiCookieForRequest = vi.fn();

vi.mock('../../src/services/bugReports.js', () => ({
  BugReportError: MockBugReportError,
  createBugReport: (...args) => mockCreateBugReport(...args),
  getAdminBugReport: (...args) => mockGetAdminBugReport(...args),
  listAdminBugReports: (...args) => mockListAdminBugReports(...args),
  updateBugReportStatus: (...args) => mockUpdateBugReportStatus(...args),
}));

vi.mock('../../src/services/eduaiAuth.js', () => ({
  getEduAiCookieForRequest: (...args) => mockGetEduAiCookieForRequest(...args),
}));

const { default: bugReportsRoutes } = await import('../../src/routes/bug-reports.js');

function buildApp({ role } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (role) req.user = { role, id: 'u1' };
    next();
  });
  app.use('/api', bugReportsRoutes);
  return app;
}

beforeEach(() => {
  mockCreateBugReport.mockReset();
  mockGetAdminBugReport.mockReset();
  mockListAdminBugReports.mockReset();
  mockUpdateBugReportStatus.mockReset();
  mockGetEduAiCookieForRequest.mockReset().mockReturnValue('cookie=abc');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/bug-reports', () => {
  it('returns 401 when unauthenticated', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/bug-reports').send({ description: 'x' });
    expect(res.status).toBe(401);
    expect(mockCreateBugReport).not.toHaveBeenCalled();
  });

  it('returns 201 on success', async () => {
    mockCreateBugReport.mockResolvedValue(undefined);
    const app = buildApp({ role: 'STUDENT' });

    const res = await request(app).post('/api/bug-reports').send({ description: 'It is broken' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
    expect(mockCreateBugReport).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'STUDENT' }),
      expect.objectContaining({ description: 'It is broken' }),
    );
  });

  it('maps a BugReportError to its status/message', async () => {
    mockCreateBugReport.mockRejectedValue(new MockBugReportError(400, 'description too short'));
    const app = buildApp({ role: 'STUDENT' });

    const res = await request(app).post('/api/bug-reports').send({ description: 'x' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'description too short' });
  });

  it('returns 500 for a generic error', async () => {
    mockCreateBugReport.mockRejectedValue(new Error('boom'));
    const app = buildApp({ role: 'STUDENT' });

    const res = await request(app).post('/api/bug-reports').send({ description: 'x' });

    expect(res.status).toBe(500);
  });

  it('defaults to an empty payload when the body is absent', async () => {
    mockCreateBugReport.mockResolvedValue(undefined);
    const app = buildApp({ role: 'STUDENT' });

    const res = await request(app).post('/api/bug-reports').set('Content-Type', 'application/json').send();

    expect(res.status).toBe(201);
    expect(mockCreateBugReport).toHaveBeenCalledWith(expect.anything(), {});
  });
});

describe('GET /api/admin/bug-reports', () => {
  it('returns 403 for a non-admin', async () => {
    const app = buildApp({ role: 'STUDENT' });
    const res = await request(app).get('/api/admin/bug-reports');
    expect(res.status).toBe(403);
    expect(mockListAdminBugReports).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated (requireRole gate)', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/admin/bug-reports');
    expect(res.status).toBe(401);
  });

  it('returns the mapped rows for an admin', async () => {
    mockListAdminBugReports.mockResolvedValue([{ id: 'br-1' }]);
    const app = buildApp({ role: 'ADMIN' });

    const res = await request(app).get('/api/admin/bug-reports');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'br-1' }]);
    expect(mockListAdminBugReports).toHaveBeenCalledWith('cookie=abc');
  });

  it('maps an error status from a rejected promise', async () => {
    mockListAdminBugReports.mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }));
    const app = buildApp({ role: 'ADMIN' });

    const res = await request(app).get('/api/admin/bug-reports');

    expect(res.status).toBe(401);
  });

  it('defaults to 500 when the rejected error has no numeric status', async () => {
    mockListAdminBugReports.mockRejectedValue(new Error('boom'));
    const app = buildApp({ role: 'ADMIN' });

    const res = await request(app).get('/api/admin/bug-reports');

    expect(res.status).toBe(500);
  });
});

describe('GET /api/admin/bug-reports/:bugReportId', () => {
  it('returns 403 for a non-admin', async () => {
    const app = buildApp({ role: 'INSTRUCTOR' });
    const res = await request(app).get('/api/admin/bug-reports/br-1');
    expect(res.status).toBe(403);
  });

  it('returns the mapped row for an admin', async () => {
    mockGetAdminBugReport.mockResolvedValue({ id: 'br-1' });
    const app = buildApp({ role: 'ADMIN' });

    const res = await request(app).get('/api/admin/bug-reports/br-1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'br-1' });
    expect(mockGetAdminBugReport).toHaveBeenCalledWith('cookie=abc', 'br-1');
  });

  it('maps a BugReportError to its status/message', async () => {
    mockGetAdminBugReport.mockRejectedValue(new MockBugReportError(404, 'Bug report not found'));
    const app = buildApp({ role: 'ADMIN' });

    const res = await request(app).get('/api/admin/bug-reports/br-missing');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Bug report not found' });
  });

  it('falls back to 500 for a generic error with no status', async () => {
    mockGetAdminBugReport.mockRejectedValue(new Error('boom'));
    const app = buildApp({ role: 'ADMIN' });

    const res = await request(app).get('/api/admin/bug-reports/br-1');

    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/admin/bug-reports/:bugReportId', () => {
  it('returns 403 for a non-admin', async () => {
    const app = buildApp({ role: 'STUDENT' });
    const res = await request(app).patch('/api/admin/bug-reports/br-1').send({ status: 'resolved' });
    expect(res.status).toBe(403);
  });

  it('updates the status for an admin', async () => {
    mockUpdateBugReportStatus.mockResolvedValue({ id: 'br-1', status: 'resolved' });
    const app = buildApp({ role: 'ADMIN' });

    const res = await request(app).patch('/api/admin/bug-reports/br-1').send({ status: 'resolved' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'br-1', status: 'resolved' });
    expect(mockUpdateBugReportStatus).toHaveBeenCalledWith('br-1', 'resolved', 'cookie=abc');
  });

  it('maps a BugReportError to its status/message', async () => {
    mockUpdateBugReportStatus.mockRejectedValue(new MockBugReportError(400, 'status must be one of: ...'));
    const app = buildApp({ role: 'ADMIN' });

    const res = await request(app).patch('/api/admin/bug-reports/br-1').send({ status: 'bogus' });

    expect(res.status).toBe(400);
  });

  it('returns 500 for a generic error', async () => {
    mockUpdateBugReportStatus.mockRejectedValue(new Error('boom'));
    const app = buildApp({ role: 'ADMIN' });

    const res = await request(app).patch('/api/admin/bug-reports/br-1').send({ status: 'resolved' });

    expect(res.status).toBe(500);
  });
});
