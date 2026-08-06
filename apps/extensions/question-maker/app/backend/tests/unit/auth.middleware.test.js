/**
 * Unit tests for QM auth middleware (requireAuth, requireRole, authenticateToken alias).
 * Mocks Core session validation and the findOrCreateUser DB call — no network or DB needed.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

process.env.CORE_URL = 'http://core.test';
process.env.EXTENSION_URL = 'http://qm.test';

const findOrCreateUser = vi.fn();

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser,
}));

const { requireAuth, requireRole, authenticateToken } = await import(
  '../../src/middleware/auth.js'
);
const { config } = await import('../../src/config/settings.js');

function makeRes() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
    redirect: vi.fn(),
    set: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  res.set.mockReturnValue(res);
  return res;
}

function makeApiReq(overrides = {}) {
  return {
    headers: {},
    path: '/api/questions',
    originalUrl: '/api/questions',
    ...overrides,
  };
}

describe('requireAuth', () => {
  let next;

  beforeEach(() => {
    next = vi.fn();
    findOrCreateUser.mockReset();
    findOrCreateUser.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls next and sets req.user on a valid session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: { id: 'u1', email: 'a@b.com', name: 'Alice', role: 'INSTRUCTOR' } }),
    }));
    const req = makeApiReq();
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toMatchObject({ id: 'u1', email: 'a@b.com', role: 'INSTRUCTOR' });
  });

  it('calls findOrCreateUser to maintain the local user row', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: { id: 'u1', email: 'a@b.com', role: 'STUDENT' } }),
    }));

    await requireAuth(makeApiReq(), makeRes(), next);

    expect(findOrCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1', email: 'a@b.com', role: 'STUDENT' }),
    );
  });

  it('returns 401 JSON when Core rejects the session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const req = makeApiReq();
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'Authentication required' }),
    );
  });

  it('returns 401 JSON when fetch throws (Core unreachable)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const req = makeApiReq();
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  // #225 edge-case audit SEAM-01 / #1197 fix: a Core 429 (IP rate limit) is
  // passed through as 429 with Retry-After forwarded, instead of collapsing
  // into a generic 401 that would make every extension API call look like
  // "logged out" during the rate-limit window.
  it('passes a Core 429 rate-limit response through as 429 with Retry-After (SEAM-01)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? '15' : null) },
      }),
    );
    const req = makeApiReq();
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith('Retry-After', '15');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'Rate limited', retryAfter: '15' }),
    );
    expect(findOrCreateUser).not.toHaveBeenCalled();
  });

  it('passes a Core 429 through even without a Retry-After header', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 429, headers: { get: () => null } }),
    );
    const req = makeApiReq();
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'Rate limited', retryAfter: null }),
    );
  });

  it('forwards the incoming cookie header to Core', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: { id: 'u1', email: 'a@b.com', role: 'STUDENT' } }),
    });
    vi.stubGlobal('fetch', mockFetch);
    const req = makeApiReq({ headers: { cookie: 'session=tok123' } });

    await requireAuth(req, makeRes(), next);

    expect(mockFetch).toHaveBeenCalledWith(
      `${config.coreUrl}/api/sessions/validate`,
      expect.objectContaining({
        method: 'POST',
        headers: { cookie: 'session=tok123' },
      }),
    );
  });

  it('normalizes an unrecognized role to STUDENT', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: { id: 'u1', email: 'a@b.com', role: 'UNKNOWN_ROLE' } }),
    }));
    const req = makeApiReq();

    await requireAuth(req, makeRes(), next);

    expect(req.user.role).toBe('STUDENT');
  });

  // #225 AUTH-12: 'TA' is no longer a valid platform role (Core drops it from
  // UserRole) — a role of 'TA' from any caller is normalized to STUDENT just
  // like any other unrecognized role.
  it('normalizes a platform role of TA to STUDENT', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: { id: 'u1', email: 'a@b.com', role: 'TA' } }),
    }));
    const req = makeApiReq();

    await requireAuth(req, makeRes(), next);

    expect(req.user.role).toBe('STUDENT');
  });

  // #225 AUTH-12: platform UserRole has no TA — a course TA is a
  // STUDENT-platform user with a TA course enrollment, so Core never returns
  // role: 'TA' here (see the "normalizes" test below for that case).
  it.each(['STUDENT', 'INSTRUCTOR', 'ADMIN', 'UNIT_ADMIN'])(
    'preserves valid role %s unchanged',
    async (role) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ user: { id: 'u1', email: 'a@b.com', role } }),
      }));
      const req = makeApiReq();

      await requireAuth(req, makeRes(), next);

      expect(req.user.role).toBe(role);
    },
  );
});

describe('requireRole', () => {
  let next;

  beforeEach(() => {
    next = vi.fn();
  });

  it('calls next when the string role matches', () => {
    requireRole('INSTRUCTOR')({ user: { role: 'INSTRUCTOR' } }, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('calls next when the role is in the allowed array', () => {
    requireRole(['INSTRUCTOR', 'TA'])({ user: { role: 'TA' } }, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 403 when the role is not allowed', () => {
    const res = makeRes();
    requireRole('INSTRUCTOR')({ user: { role: 'STUDENT' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.stringContaining('INSTRUCTOR') }),
    );
  });

  it('returns 401 when req.user is absent', () => {
    const res = makeRes();
    requireRole('INSTRUCTOR')({}, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'Authentication required' }),
    );
  });
});

describe('authenticateToken (backward-compat alias)', () => {
  it('is the same function reference as requireAuth', () => {
    expect(authenticateToken).toBe(requireAuth);
  });
});
