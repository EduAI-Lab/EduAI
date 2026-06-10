/**
 * GET /api/auth/me — the bug-report triage flag is now role-based (§11, #311
 * item 5): ADMIN-only, replacing the previous BUG_REPORT_ADMIN_EMAILS allowlist
 * (and dropping UNIT_ADMIN). No DB: session validation + findOrCreateUser mocked.
 */
import { vi, describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/config/settings.js', () => {
  const cfg = {
    coreUrl: 'http://core.test',
    eduaiApiKey: 'k',
    corsOrigins: ['*'],
    nodeEnv: 'test',
    logLevel: 'silent',
    // An allowlist that, under the old behavior, would have granted bug-admin —
    // it must now be ignored.
    bugReportAdminEmails: ['inst@test.com'],
  };
  return { config: cfg, default: cfg };
});

const { default: app } = await import('../../src/app.js');

function authAs(user) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ user }) }));
}

afterEach(() => vi.restoreAllMocks());

describe('GET /api/auth/me isBugReportAdmin (role-only, ADMIN)', () => {
  it('is true for ADMIN', async () => {
    authAs({ id: 'a', email: 'admin@test.com', role: 'ADMIN', name: 'A' });
    const res = await request(app).get('/api/auth/me').set('Cookie', 'session=v');
    expect(res.status).toBe(200);
    expect(res.body.user.isBugReportAdmin).toBe(true);
  });

  it.each(['UNIT_ADMIN', 'INSTRUCTOR', 'TA', 'STUDENT'])('is false for %s', async (role) => {
    authAs({ id: 'u', email: 'inst@test.com', role, name: 'U' });
    const res = await request(app).get('/api/auth/me').set('Cookie', 'session=v');
    expect(res.status).toBe(200);
    // Even though inst@test.com is in the legacy allowlist, role-only gating wins.
    expect(res.body.user.isBugReportAdmin).toBe(false);
  });
});
