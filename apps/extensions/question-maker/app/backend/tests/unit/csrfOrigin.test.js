import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/settings.js', () => ({
  config: {
    corsOrigins: ['https://qm.example.test'],
    corePublicOrigin: 'https://core.example.test',
    extensionUrl: 'https://qm.example.test',
  },
}));

const { csrfOriginGuard, trustedOrigins } = await import('../../src/middleware/csrfOrigin.js');

function response() {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res;
}

function request(method, headers = {}) {
  return { method, headers };
}

describe('csrfOriginGuard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('normalizes and deduplicates configured trusted origins', () => {
    expect(trustedOrigins({
      corsOrigins: ['https://qm.example.test/', 'https://qm.example.test', '*'],
      corePublicOrigin: 'https://core.example.test/path',
      extensionUrl: 'not-an-origin',
    })).toEqual(new Set(['https://qm.example.test', 'https://core.example.test']));

    expect(trustedOrigins({
      corsOrigins: 'https://qm.example.test, https://admin.example.test/',
    })).toEqual(new Set(['https://qm.example.test', 'https://admin.example.test']));
  });

  it('rejects an untrusted Origin before invoking the route', () => {
    const res = response();
    const next = vi.fn();

    csrfOriginGuard(request('POST', {
      cookie: 'session=abc',
      origin: 'https://evil.example.test',
    }), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Cross-site request blocked',
      code: 'CSRF_ORIGIN_DENIED',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows trusted and server requests while rejecting explicit Fetch Metadata cross-site', () => {
    const trustedNext = vi.fn();
    csrfOriginGuard(request('PATCH', {
      cookie: 'session=abc',
      origin: 'https://qm.example.test',
    }), response(), trustedNext);
    expect(trustedNext).toHaveBeenCalledOnce();

    const serverNext = vi.fn();
    csrfOriginGuard(request('DELETE', { cookie: 'session=abc' }), response(), serverNext);
    expect(serverNext).toHaveBeenCalledOnce();

    const crossSiteRes = response();
    const crossSiteNext = vi.fn();
    csrfOriginGuard(request('POST', {
      cookie: 'session=abc',
      'sec-fetch-site': 'CROSS-SITE',
    }), crossSiteRes, crossSiteNext);
    expect(crossSiteRes.status).toHaveBeenCalledWith(403);
    expect(crossSiteNext).not.toHaveBeenCalled();
  });

  it('does not gate safe methods or requests without cookies', () => {
    const getNext = vi.fn();
    csrfOriginGuard(request('GET', {
      cookie: 'session=abc',
      origin: 'https://evil.example.test',
    }), response(), getNext);
    expect(getNext).toHaveBeenCalledOnce();

    const noCookieNext = vi.fn();
    csrfOriginGuard(request('POST', { origin: 'https://evil.example.test' }), response(), noCookieNext);
    expect(noCookieNext).toHaveBeenCalledOnce();
  });
});
