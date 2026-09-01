// @vitest-environment node
// #1213 — /api/courses ($.ts): loader delegates to getCourses; the action
// only handles POST (create), rejecting other methods, and fires an audit
// log on a successful 201 create.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/courses/server", () => ({
  getCourses: vi.fn(),
  createCourse: vi.fn(),
}));

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn((p: Promise<unknown>) => p),
  logAuditAction: vi.fn().mockResolvedValue(undefined),
}));

import { loader, action } from "~/routes/api/courses.$";
import { getCourses, createCourse } from "~/lib/courses/server";
import { auth } from "~/lib/auth/server";
import { logAuditAction } from "~/lib/logging.server";

function makeArgs(method: string) {
  return {
    request: new Request("http://localhost/api/courses", { method }),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "u1", role: "ADMIN" },
  } as never);
});

describe("GET /api/courses", () => {
  it("delegates to getCourses", async () => {
    const response = new Response(JSON.stringify({ courses: [] }));
    vi.mocked(getCourses).mockResolvedValue(response as never);
    const res = await loader(makeArgs("GET"));
    expect(res).toBe(response);
  });
});

describe("/api/courses action", () => {
  it("rejects non-POST methods with 405", async () => {
    const res = await action(makeArgs("DELETE"));
    expect(res.status).toBe(405);
    expect(createCourse).not.toHaveBeenCalled();
  });

  it("logs COURSE_CREATED on a successful 201 create", async () => {
    vi.mocked(createCourse).mockResolvedValue(
      new Response(JSON.stringify({ id: "course-1", code: "COSC101" }), { status: 201 }),
    );
    const res = await action(makeArgs("POST"));
    expect(res.status).toBe(201);
    expect(logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionCode: "COURSE_CREATED", entityId: "course-1" }),
    );
  });

  it("does not log when create fails (non-201)", async () => {
    vi.mocked(createCourse).mockResolvedValue(new Response(null, { status: 400 }));
    await action(makeArgs("POST"));
    expect(logAuditAction).not.toHaveBeenCalled();
  });
});
