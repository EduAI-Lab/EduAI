import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { EventEmitter } from 'node:events';

vi.mock("../../src/services/policyService.js", () => ({
  getPolicy: vi.fn(),
}));

vi.mock("../../src/services/courseResolver.js", () => ({
  resolveCoreCourseById: vi.fn(),
}));

import {
  requireAuth,
  requireRole,
  requireRoles,
  requireInstructorPolicy,
  isUnitAdminForCourse,
} from "../../src/middleware/auth.js";
import { getPolicy } from "../../src/services/policyService.js";
import { resolveCoreCourseById } from "../../src/services/courseResolver.js";

process.env.CORE_URL = 'http://core.test';
const originalCoreAuthTimeoutMs = process.env.CORE_AUTH_TIMEOUT_MS;

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

function makeReq(overrides = {}) {
  return {
    headers: { cookie: 'session=test' },
    path: '/api/something',
    originalUrl: '/api/something',
    ...overrides,
  };
}

describe("requireAuth", () => {
  let next;

  beforeEach(() => {
    next = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalCoreAuthTimeoutMs === undefined) {
      delete process.env.CORE_AUTH_TIMEOUT_MS;
    } else {
      process.env.CORE_AUTH_TIMEOUT_MS = originalCoreAuthTimeoutMs;
    }
  });

  it('calls next and populates req.user on a valid session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            user: { id: 'u1', email: 'a@b.com', name: 'Alice', role: 'INSTRUCTOR' },
          }),
      }),
    );
    const req = makeReq();
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toMatchObject({ id: "u1", email: "a@b.com", role: "INSTRUCTOR" });
  });

  it('does not treat normal Express POST body completion as caller cancellation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, { signal }) =>
          new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            setImmediate(() =>
              resolve({
                ok: true,
                status: 200,
                json: () =>
                  Promise.resolve({
                    user: { id: 'u1', email: 'a@b.com', name: 'Alice', role: 'INSTRUCTOR' },
                  }),
              }),
            );
          }),
      ),
    );

    const app = express();
    app.use(express.json());
    app.post('/protected', requireAuth, (_req, res) => res.json({ ok: true }));

    const response = await request(app)
      .post('/protected')
      .set('Cookie', 'session=test')
      .send({ provider: 'opencode' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('returns 401 only when Core verifies that the session is unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const req = makeReq();
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Authentication required" });
  });

  it('preserves a verified Core 403 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const req = makeReq();
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication forbidden' });
  });

  it('returns 503 when Core session validation responds with a 5xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const req = makeReq();
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication service unavailable' });
  });

  it('returns 504 when Core session validation never responds before the configured deadline', async () => {
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
    const req = makeReq();
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(504);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication service timed out' });
  });

  it('composes an available caller cancellation signal with the deadline', async () => {
    process.env.CORE_AUTH_TIMEOUT_MS = '1000';
    const caller = new AbortController();
    let forwardedSignal;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, { signal }) => {
        forwardedSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          caller.abort();
        });
      }),
    );
    const req = makeReq({ signal: caller.signal });
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(forwardedSignal).not.toBe(caller.signal);
    expect(forwardedSignal.aborted).toBe(true);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.status).not.toHaveBeenCalledWith(401);
  });

  it('cancels Core authentication when an Express request is actually aborted', async () => {
    process.env.CORE_AUTH_TIMEOUT_MS = '1000';
    const req = Object.assign(new EventEmitter(), makeReq());
    let forwardedSignal;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, { signal }) => {
        forwardedSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          setImmediate(() => req.emit('aborted'));
        });
      }),
    );
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(forwardedSignal.aborted).toBe(true);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.status).not.toHaveBeenCalledWith(401);
  });

  // Edge-case audit #225 (SEAM-01 / #1197 fix): a Core 429 (IP rate limit) is
  // passed through as 429 with the Retry-After hint forwarded, instead of
  // being collapsed into a generic 401 that would otherwise make every
  // extension API call look like "logged out" during the rate-limit window.
  it("passes a Core 429 rate-limit response through as 429 with Retry-After (SEAM-01)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: { get: (name) => (name.toLowerCase() === "retry-after" ? "30" : null) },
      }),
    );
    const req = makeReq();
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith("Retry-After", "30");
    expect(res.json).toHaveBeenCalledWith({ error: "Rate limited", retryAfter: "30" });
  });

  it("passes a Core 429 through even without a Retry-After header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: { get: () => null },
      }),
    );
    const req = makeReq();
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ error: "Rate limited", retryAfter: null });
  });

  it('returns 503 when Core is unreachable (fetch throws)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const req = makeReq();
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication service unavailable' });
  });

  it("forwards the incoming cookie header to Core", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: { id: "u1", email: "a@b.com", role: "STUDENT" } }),
    });
    vi.stubGlobal("fetch", mockFetch);
    const req = makeReq({ headers: { cookie: "session=abc123; other=x" } });
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(mockFetch).toHaveBeenCalledWith(
      "http://core.test/api/sessions/validate",
      expect.objectContaining({
        method: "POST",
        headers: { cookie: "session=abc123; other=x" },
      }),
    );
  });

  it('returns 401 without calling Core when the request has no cookie header', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const req = makeReq({ headers: {} });
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
  });

  it('normalizes an unrecognized role to STUDENT (least privilege)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ user: { id: 'u1', email: 'a@b.com', role: 'SUPERUSER' } }),
      }),
    );
    const req = makeReq();
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(req.user.role).toBe("STUDENT");
  });

  it.each(["STUDENT", "INSTRUCTOR", "TA", "ADMIN", "UNIT_ADMIN"])(
    "preserves valid role %s unchanged",
    async (role) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ user: { id: 'u1', email: 'a@b.com', role } }),
        }),
      );
      const req = makeReq();
      const res = makeRes();

      await requireAuth(req, res, next);

      expect(req.user.role).toBe(role);
    },
  );
});

describe("requireRole", () => {
  let next;

  beforeEach(() => {
    next = vi.fn();
  });

  it("calls next when the string role matches", () => {
    const req = { user: { role: "INSTRUCTOR" } };
    requireRole("INSTRUCTOR")(req, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("calls next when the role is in the allowed array", () => {
    const req = { user: { role: "TA" } };
    requireRole(["INSTRUCTOR", "TA"])(req, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 403 when the role is not in the allowed list", () => {
    const req = { user: { role: "STUDENT" } };
    const res = makeRes();
    requireRole("INSTRUCTOR")(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("INSTRUCTOR") }),
    );
  });

  it("returns 401 when req.user is absent (called before requireAuth)", () => {
    const req = {};
    const res = makeRes();
    requireRole("INSTRUCTOR")(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Authentication required" });
  });

  it("lists all required roles in the 403 error message", () => {
    const req = { user: { role: "STUDENT" } };
    const res = makeRes();
    requireRole(["ADMIN", "INSTRUCTOR"])(req, res, next);
    const [body] = res.json.mock.calls[0];
    expect(body.error).toContain("ADMIN");
    expect(body.error).toContain("INSTRUCTOR");
  });
});

describe("requireRoles (backward-compat alias)", () => {
  it("is the same function reference as requireRole", () => {
    expect(requireRoles).toBe(requireRole);
  });
});

describe("requireInstructorPolicy", () => {
  let next;

  beforeEach(() => {
    next = vi.fn();
    vi.clearAllMocks();
  });

  it("passes non-instructors through without consulting the policy (ADMIN unaffected)", async () => {
    const req = { user: { role: "ADMIN" } };
    await requireInstructorPolicy("instructors.canCreateCourses")(req, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(getPolicy).not.toHaveBeenCalled();
  });

  it("allows an INSTRUCTOR when the policy flag is enabled", async () => {
    getPolicy.mockResolvedValue(true);
    const req = { user: { role: "INSTRUCTOR" } };
    await requireInstructorPolicy("instructors.canCreateCourses")(req, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(getPolicy).toHaveBeenCalledWith("instructors.canCreateCourses");
  });

  it("blocks an INSTRUCTOR with 403 when the policy flag is disabled", async () => {
    getPolicy.mockResolvedValue(false);
    const req = { user: { role: "INSTRUCTOR" } };
    const res = makeRes();
    await requireInstructorPolicy("instructors.canCreateCourses")(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// #1072 step 4: `department` is Core-owned — CourseOffering carries no local
// column anymore, so `isUnitAdminForCourse` is async and resolves it either
// from a caller-supplied `resolvedCoreCourse` (fast path, no Core call) or by
// fetching `resolveCoreCourseById(course.coreOfferingId)` itself.
describe("isUnitAdminForCourse", () => {
  const course = { coreOfferingId: "core-1" };
  const coreCourse = { department: "COSC" };
  const coreCourseNoDept = { department: null };
  const unitAdminCosc = { role: "UNIT_ADMIN", authorizedUnits: ["COSC", "MATH"] };
  const unitAdminOther = { role: "UNIT_ADMIN", authorizedUnits: ["PHYS"] };
  const unitAdminEmpty = { role: "UNIT_ADMIN", authorizedUnits: [] };
  const instructor = { role: "INSTRUCTOR", authorizedUnits: ["COSC"] };

  beforeEach(() => {
    resolveCoreCourseById.mockReset();
  });

  describe("with a pre-resolved Core course (fast path — no Core call)", () => {
    it("returns true when role is UNIT_ADMIN and department is in authorizedUnits", async () => {
      expect(await isUnitAdminForCourse(unitAdminCosc, course, coreCourse)).toBe(true);
      expect(resolveCoreCourseById).not.toHaveBeenCalled();
    });

    it("returns false when authorizedUnits does not include the department", async () => {
      expect(await isUnitAdminForCourse(unitAdminOther, course, coreCourse)).toBe(false);
    });

    it("returns false when authorizedUnits is empty", async () => {
      expect(await isUnitAdminForCourse(unitAdminEmpty, course, coreCourse)).toBe(false);
    });

    it("returns false when the resolved Core course has no department (null never matches)", async () => {
      expect(await isUnitAdminForCourse(unitAdminCosc, course, coreCourseNoDept)).toBe(false);
    });

    it("returns false when role is not UNIT_ADMIN", async () => {
      expect(await isUnitAdminForCourse(instructor, course, coreCourse)).toBe(false);
    });

    it("returns false when user is null", async () => {
      expect(await isUnitAdminForCourse(null, course, coreCourse)).toBe(false);
    });

    it("returns false when authorizedUnits is not an array", async () => {
      const user = { role: "UNIT_ADMIN", authorizedUnits: "COSC" };
      expect(await isUnitAdminForCourse(user, course, coreCourse)).toBe(false);
    });
  });

  describe("self-resolving (no resolvedCoreCourse passed)", () => {
    it("returns false without a Core call when course is null", async () => {
      expect(await isUnitAdminForCourse(unitAdminCosc, null)).toBe(false);
      expect(resolveCoreCourseById).not.toHaveBeenCalled();
    });

    it("returns false without a Core call when course.coreOfferingId is null", async () => {
      expect(await isUnitAdminForCourse(unitAdminCosc, { coreOfferingId: null })).toBe(false);
      expect(resolveCoreCourseById).not.toHaveBeenCalled();
    });

    it("resolves the department via resolveCoreCourseById and returns true on a match", async () => {
      resolveCoreCourseById.mockResolvedValue({ course: coreCourse, coreUnavailable: false });
      expect(await isUnitAdminForCourse(unitAdminCosc, course)).toBe(true);
      expect(resolveCoreCourseById).toHaveBeenCalledWith("core-1");
    });

    it("fails soft to false when Core is unavailable", async () => {
      resolveCoreCourseById.mockResolvedValue({ course: null, coreUnavailable: true });
      expect(await isUnitAdminForCourse(unitAdminCosc, course)).toBe(false);
    });
  });
});
