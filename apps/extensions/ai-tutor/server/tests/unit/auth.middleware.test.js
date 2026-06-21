import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/services/policyService.js', () => ({
  getPolicy: vi.fn(),
}));

import {
  requireAuth,
  requireRole,
  requireRoles,
  requireInstructorPolicy,
  isUnitAdminForCourse,
} from '../../src/middleware/auth.js';
import { getPolicy } from '../../src/services/policyService.js';

process.env.CORE_URL = 'http://core.test';

function makeRes() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
    redirect: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function makeReq(overrides = {}) {
  return {
    headers: {},
    path: '/api/something',
    originalUrl: '/api/something',
    ...overrides,
  };
}

describe('requireAuth', () => {
  let next;

  beforeEach(() => {
    next = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls next and populates req.user on a valid session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: { id: 'u1', email: 'a@b.com', name: 'Alice', role: 'INSTRUCTOR' } }),
    }));
    const req = makeReq();
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toMatchObject({ id: 'u1', email: 'a@b.com', role: 'INSTRUCTOR' });
  });

  it('returns 401 when Core responds with a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const req = makeReq();
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
  });

  it('returns 401 when Core is unreachable (fetch throws)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const req = makeReq();
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
  });

  it('forwards the incoming cookie header to Core', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: { id: 'u1', email: 'a@b.com', role: 'STUDENT' } }),
    });
    vi.stubGlobal('fetch', mockFetch);
    const req = makeReq({ headers: { cookie: 'session=abc123; other=x' } });
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://core.test/api/sessions/validate',
      expect.objectContaining({
        method: 'POST',
        headers: { cookie: 'session=abc123; other=x' },
      }),
    );
  });

  it('sends an empty cookie string when the request has no cookie header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: { id: 'u1', email: 'a@b.com', role: 'STUDENT' } }),
    });
    vi.stubGlobal('fetch', mockFetch);
    const req = makeReq({ headers: {} });
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { cookie: '' } }),
    );
  });

  it('normalizes an unrecognized role to STUDENT (least privilege)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: { id: 'u1', email: 'a@b.com', role: 'SUPERUSER' } }),
    }));
    const req = makeReq();
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(req.user.role).toBe('STUDENT');
  });

  it.each(['STUDENT', 'INSTRUCTOR', 'TA', 'ADMIN', 'UNIT_ADMIN'])(
    'preserves valid role %s unchanged',
    async (role) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ user: { id: 'u1', email: 'a@b.com', role } }),
      }));
      const req = makeReq();
      const res = makeRes();

      await requireAuth(req, res, next);

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
    const req = { user: { role: 'INSTRUCTOR' } };
    requireRole('INSTRUCTOR')(req, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('calls next when the role is in the allowed array', () => {
    const req = { user: { role: 'TA' } };
    requireRole(['INSTRUCTOR', 'TA'])(req, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 403 when the role is not in the allowed list', () => {
    const req = { user: { role: 'STUDENT' } };
    const res = makeRes();
    requireRole('INSTRUCTOR')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('INSTRUCTOR') }),
    );
  });

  it('returns 401 when req.user is absent (called before requireAuth)', () => {
    const req = {};
    const res = makeRes();
    requireRole('INSTRUCTOR')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
  });

  it('lists all required roles in the 403 error message', () => {
    const req = { user: { role: 'STUDENT' } };
    const res = makeRes();
    requireRole(['ADMIN', 'INSTRUCTOR'])(req, res, next);
    const [body] = res.json.mock.calls[0];
    expect(body.error).toContain('ADMIN');
    expect(body.error).toContain('INSTRUCTOR');
  });
});

describe('requireRoles (backward-compat alias)', () => {
  it('is the same function reference as requireRole', () => {
    expect(requireRoles).toBe(requireRole);
  });
});

describe('requireInstructorPolicy', () => {
  let next;

  beforeEach(() => {
    next = vi.fn();
    vi.clearAllMocks();
  });

  it('passes non-instructors through without consulting the policy (ADMIN unaffected)', async () => {
    const req = { user: { role: 'ADMIN' } };
    await requireInstructorPolicy('instructors.canCreateCourses')(req, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(getPolicy).not.toHaveBeenCalled();
  });

  it('allows an INSTRUCTOR when the policy flag is enabled', async () => {
    getPolicy.mockResolvedValue(true);
    const req = { user: { role: 'INSTRUCTOR' } };
    await requireInstructorPolicy('instructors.canCreateCourses')(req, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(getPolicy).toHaveBeenCalledWith('instructors.canCreateCourses');
  });

  it('blocks an INSTRUCTOR with 403 when the policy flag is disabled', async () => {
    getPolicy.mockResolvedValue(false);
    const req = { user: { role: 'INSTRUCTOR' } };
    const res = makeRes();
    await requireInstructorPolicy('instructors.canCreateCourses')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('isUnitAdminForCourse', () => {
  const course = { department: 'COSC' };
  const courseNoDept = { department: null };
  const unitAdminCosc = { role: 'UNIT_ADMIN', authorizedUnits: ['COSC', 'MATH'] };
  const unitAdminOther = { role: 'UNIT_ADMIN', authorizedUnits: ['PHYS'] };
  const unitAdminEmpty = { role: 'UNIT_ADMIN', authorizedUnits: [] };
  const instructor = { role: 'INSTRUCTOR', authorizedUnits: ['COSC'] };

  it('returns true when role is UNIT_ADMIN and department is in authorizedUnits', () => {
    expect(isUnitAdminForCourse(unitAdminCosc, course)).toBe(true);
  });

  it('returns false when authorizedUnits does not include the department', () => {
    expect(isUnitAdminForCourse(unitAdminOther, course)).toBe(false);
  });

  it('returns false when authorizedUnits is empty', () => {
    expect(isUnitAdminForCourse(unitAdminEmpty, course)).toBe(false);
  });

  it('returns false when course.department is null (null never matches)', () => {
    expect(isUnitAdminForCourse(unitAdminCosc, courseNoDept)).toBe(false);
  });

  it('returns false when role is not UNIT_ADMIN', () => {
    expect(isUnitAdminForCourse(instructor, course)).toBe(false);
  });

  it('returns false when user is null', () => {
    expect(isUnitAdminForCourse(null, course)).toBe(false);
  });

  it('returns false when course is null', () => {
    expect(isUnitAdminForCourse(unitAdminCosc, null)).toBe(false);
  });

  it('returns false when authorizedUnits is not an array', () => {
    const user = { role: 'UNIT_ADMIN', authorizedUnits: 'COSC' };
    expect(isUnitAdminForCourse(user, course)).toBe(false);
  });
});
