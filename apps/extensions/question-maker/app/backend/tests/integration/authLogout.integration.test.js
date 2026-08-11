/**
 * Integration tests for POST /api/auth/logout (issue #1217: auth.js's
 * server-to-server sign-out proxy had no test coverage at all — authMeBugReport
 * test only exercises GET /api/auth/me).
 *
 * No requireAuth on this route, so no session-validation mock is needed. The
 * Core sign-out response remains authoritative and is mocked directly.
 */
import { vi, describe, it, expect, afterEach } from "vitest";
import request from "supertest";

vi.mock("../../src/services/authService.js", () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../src/config/settings.js", () => {
  const cfg = {
    coreUrl: "http://core.test",
    corePublicOrigin: "http://core-public.test",
    corsOrigins: ["*"],
    nodeEnv: "test",
    logLevel: "silent",
  };
  return { config: cfg, default: cfg };
});

const { default: app } = await import('../../src/app.js');
const originalCoreAuthTimeoutMs = process.env.CORE_AUTH_TIMEOUT_MS;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalCoreAuthTimeoutMs === undefined) {
    delete process.env.CORE_AUTH_TIMEOUT_MS;
  } else {
    process.env.CORE_AUTH_TIMEOUT_MS = originalCoreAuthTimeoutMs;
  }
});

describe("POST /api/auth/logout", () => {
  it("proxies sign-out to Core and returns ok:true on success", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", mockFetch);

    const res = await request(app).post("/api/auth/logout").set("Cookie", "session=valid");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://core.test/api/auth/sign-out");
    expect(opts.headers.cookie).toBe("session=valid");
    expect(opts.headers.origin).toBe("http://core-public.test");
  });

  it('returns 503 instead of ok:true when Core responds with a 5xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).post("/api/auth/logout");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, error: 'Logout service unavailable' });
    expect(errSpy).toHaveBeenCalledWith('[question-maker] Core sign-out failed', 500);
  });

  it('returns 503 instead of ok:true when Core is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).post("/api/auth/logout");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, error: 'Logout service unavailable' });
    expect(errSpy).toHaveBeenCalledWith(
      "[question-maker] Core sign-out request failed",
      expect.any(Error),
    );
  });

  it('returns 504 when Core logout never responds before the configured deadline', async () => {
    process.env.CORE_AUTH_TIMEOUT_MS = '5';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          }),
      ),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(504);
    expect(res.body).toEqual({ ok: false, error: 'Logout service timed out' });
  });
});
