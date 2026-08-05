/**
 * Integration tests for POST /api/auth/logout (issue #1217: auth.js's
 * server-to-server sign-out proxy had no test coverage at all — authMeBugReport
 * test only exercises GET /api/auth/me).
 *
 * No requireAuth on this route (signing out an invalid session is a no-op), so
 * no session mock is needed. Only the Core fetch call is mocked.
 */
import { vi, describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/config/settings.js', () => {
  const cfg = {
    coreUrl: 'http://core.test',
    corePublicOrigin: 'http://core-public.test',
    corsOrigins: ['*'],
    nodeEnv: 'test',
    logLevel: 'silent',
  };
  return { config: cfg, default: cfg };
});

const { default: app } = await import('../../src/app.js');

afterEach(() => vi.restoreAllMocks());

describe('POST /api/auth/logout', () => {
  it('proxies sign-out to Core and returns ok:true on success', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    const res = await request(app).post('/api/auth/logout').set('Cookie', 'session=valid');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://core.test/api/auth/sign-out');
    expect(opts.headers.cookie).toBe('session=valid');
    expect(opts.headers.origin).toBe('http://core-public.test');
  });

  it('still returns ok:true when Core responds with a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(errSpy).toHaveBeenCalledWith('[question-maker] Core sign-out failed', 500);
  });

  it('still returns ok:true when Core is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(errSpy).toHaveBeenCalledWith(
      '[question-maker] Core sign-out request failed',
      expect.any(Error),
    );
  });
});
