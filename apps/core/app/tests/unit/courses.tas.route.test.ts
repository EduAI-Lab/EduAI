// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn().mockResolvedValue({ response: null, session: null }),
}));

vi.mock("~/lib/policy.server", () => ({
  getPolicy: vi.fn(),
  logPolicyDenial: vi.fn(),
  denyByPolicy: vi.fn(
    () =>
      new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
  ),
}));

vi.mock("~/lib/courses/tas.server", () => ({
  getCourseTA: vi.fn().mockResolvedValue([]),
  addCourseTA: vi
    .fn()
    .mockResolvedValue({ ta: { id: "ta1", user: { id: "ta9", name: "TA Nine" } } }),
  removeCourseTA: vi.fn().mockResolvedValue({ ok: true, taId: "ta1", taName: "TA Nine" }),
}));

vi.mock("~/lib/rbac/resolve-course-access.server", () => ({
  resolveCourseAccess: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    course: { findUnique: vi.fn().mockResolvedValue({ id: "c1", instructorId: "u1", department: "COSC" }) },
    user: { findUnique: vi.fn().mockResolvedValue({ authorizedUnits: [] }) },
  },
}));

import { loader, action } from "~/routes/api/courses.tas.$";
import { auth } from "~/lib/auth/server";
import { getPolicy } from "~/lib/policy.server";
import { resolveCourseAccess } from "~/lib/rbac/resolve-course-access.server";

function loaderArgs(role: string) {
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role } } as never);
  return { request: new Request("http://localhost/api/courses/c1/tas"), params: { courseId: "c1" }, context: {} as never };
}

function postArgs(role: string) {
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role } } as never);
  return {
    request: new Request("http://localhost/api/courses/c1/tas", {
      method: "POST",
      body: JSON.stringify({ userId: "ta9" }),
    }),
    params: { courseId: "c1" },
    context: {} as never,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("courses.tas — instructors.canManageEnrollments gate", () => {
  // Reading the TA roster is open to anyone with course access (students see
  // their teaching team, #532590c9); only mutations are gated in `action`.
  it("GET: a student with course access may read the roster (200, no policy gate)", async () => {
    vi.mocked(resolveCourseAccess).mockResolvedValue("student");
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await loader(loaderArgs("STUDENT"));
    expect(res.status).toBe(200);
    expect(getPolicy).not.toHaveBeenCalled();
  });

  it("GET: a TA with course access may read the roster (200)", async () => {
    vi.mocked(resolveCourseAccess).mockResolvedValue("ta");
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await loader(loaderArgs("TA"));
    expect(res.status).toBe(200);
  });

  it("GET: returns 403 only when the viewer has no course access", async () => {
    vi.mocked(resolveCourseAccess).mockResolvedValue(null as never);
    const res = await loader(loaderArgs("STUDENT"));
    expect(res.status).toBe(403);
  });

  it("POST: admits an owning INSTRUCTOR when the flag is on (201)", async () => {
    vi.mocked(resolveCourseAccess).mockResolvedValue("instructor");
    vi.mocked(getPolicy).mockResolvedValue(true);
    const res = await action(postArgs("INSTRUCTOR"));
    expect(res.status).toBe(201);
  });

  it("POST: returns 403 for an INSTRUCTOR when the flag is off", async () => {
    vi.mocked(resolveCourseAccess).mockResolvedValue("instructor");
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await action(postArgs("INSTRUCTOR"));
    expect(res.status).toBe(403);
  });

  it("ADMIN reads the roster without consulting any policy (200)", async () => {
    vi.mocked(resolveCourseAccess).mockResolvedValue("admin");
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await loader(loaderArgs("ADMIN"));
    expect(res.status).toBe(200);
    expect(getPolicy).not.toHaveBeenCalled();
  });

  it("POST (mutation): a TA is forbidden regardless of the flag", async () => {
    vi.mocked(resolveCourseAccess).mockResolvedValue("ta");
    vi.mocked(getPolicy).mockResolvedValue(true);
    const res = await action(postArgs("TA"));
    expect(res.status).toBe(403);
  });
});
