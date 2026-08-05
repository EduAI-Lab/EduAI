// @vitest-environment node
// #1213 — GET/PATCH /api/questions/:id: service-key vs session auth, the
// includeDeleted forensics bypass, TA own-only edit carve-out, and the
// testable-flag validation branch.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  requireServiceKey: vi.fn().mockResolvedValue(null),
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccess: vi.fn(),
  stripAnswerForStudents: vi.fn((q: unknown) => q),
  wantsIncludeDeleted: vi.fn().mockReturnValue(false),
}));

vi.mock("~/lib/questions/server", () => ({
  getQuestionById: vi.fn(),
  updateQuestionTestable: vi.fn(),
}));

import { loader, action } from "~/routes/api/questions.$id";
import { auth } from "~/lib/auth/server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import { resolveCourseAccess, wantsIncludeDeleted } from "~/lib/auth/course-access.server";
import { getQuestionById, updateQuestionTestable } from "~/lib/questions/server";

function makeLoaderArgs(headers: Record<string, string> = {}) {
  return {
    request: new Request("http://localhost/api/questions/q1", { headers }),
    params: { id: "q1" },
    context: {} as never,
  } as never;
}

function makeActionArgs(body: unknown, method = "PATCH", headers: Record<string, string> = {}) {
  return {
    request: new Request("http://localhost/api/questions/q1", {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    params: { id: "q1" },
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireServiceKey).mockResolvedValue(null);
  vi.mocked(wantsIncludeDeleted).mockReturnValue(false);
});

describe("GET /api/questions/:id", () => {
  it("returns 401 for anonymous session callers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(401);
  });

  it("returns 404 when the question does not exist", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "INSTRUCTOR" },
    } as never);
    vi.mocked(getQuestionById).mockResolvedValue(null);
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(404);
  });

  it("returns 403 for a caller with no course access", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(getQuestionById).mockResolvedValue({ id: "q1", courseId: "course-1" } as never);
    vi.mocked(resolveCourseAccess).mockResolvedValue(null);
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(403);
  });

  it("returns the question for an authorized user", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "INSTRUCTOR" },
    } as never);
    vi.mocked(getQuestionById).mockResolvedValue({ id: "q1", courseId: "course-1" } as never);
    vi.mocked(resolveCourseAccess).mockResolvedValue({ level: "instructor", rank: 2 } as never);
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(200);
  });

  it("bypasses the access resolver when includeDeleted forensics is on", async () => {
    vi.mocked(wantsIncludeDeleted).mockReturnValue(true);
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    vi.mocked(getQuestionById).mockResolvedValue({ id: "q1", courseId: "course-1" } as never);
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(200);
    expect(resolveCourseAccess).not.toHaveBeenCalled();
  });

  it("returns the guard response directly for an invalid service key", async () => {
    vi.mocked(requireServiceKey).mockResolvedValue(new Response(null, { status: 401 }) as never);
    const res = await loader(makeLoaderArgs({ Authorization: "Bearer bad" }));
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/questions/:id", () => {
  it("rejects non-PATCH methods with 405", async () => {
    const res = await action(makeActionArgs({}, "DELETE"));
    expect(res.status).toBe(405);
  });

  it("returns 401 for anonymous callers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await action(makeActionArgs({ testable: true }));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the question does not exist", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "INSTRUCTOR" },
    } as never);
    vi.mocked(getQuestionById).mockResolvedValue(null);
    const res = await action(makeActionArgs({ testable: true }));
    expect(res.status).toBe(404);
  });

  it("allows a TA to edit their own question (own-only carve-out)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "ta-1", role: "STUDENT" },
    } as never);
    vi.mocked(getQuestionById).mockResolvedValue({
      id: "q1",
      courseId: "course-1",
      createdBy: "ta-1",
    } as never);
    vi.mocked(resolveCourseAccess).mockResolvedValue({ level: "ta", rank: 1 } as never);
    vi.mocked(updateQuestionTestable).mockResolvedValue({ id: "q1", testable: true } as never);

    const res = await action(makeActionArgs({ testable: true }));
    expect(res.status).toBe(200);
  });

  it("forbids a TA editing someone else's question", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "ta-1", role: "STUDENT" },
    } as never);
    vi.mocked(getQuestionById).mockResolvedValue({
      id: "q1",
      courseId: "course-1",
      createdBy: "someone-else",
    } as never);
    vi.mocked(resolveCourseAccess).mockResolvedValue({ level: "ta", rank: 1 } as never);

    const res = await action(makeActionArgs({ testable: true }));
    expect(res.status).toBe(403);
    expect(updateQuestionTestable).not.toHaveBeenCalled();
  });

  it("returns 422 when testable is not a boolean", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "INSTRUCTOR" },
    } as never);
    vi.mocked(getQuestionById).mockResolvedValue({ id: "q1", courseId: "course-1" } as never);
    vi.mocked(resolveCourseAccess).mockResolvedValue({ level: "instructor", rank: 2 } as never);

    const res = await action(makeActionArgs({ testable: "yes" }));
    expect(res.status).toBe(422);
  });

  it("returns 404 when the update target no longer exists", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "INSTRUCTOR" },
    } as never);
    vi.mocked(getQuestionById).mockResolvedValue({ id: "q1", courseId: "course-1" } as never);
    vi.mocked(resolveCourseAccess).mockResolvedValue({ level: "instructor", rank: 2 } as never);
    vi.mocked(updateQuestionTestable).mockResolvedValue(null);

    const res = await action(makeActionArgs({ testable: true }));
    expect(res.status).toBe(404);
  });

  it("skips the access check entirely for a valid service key", async () => {
    vi.mocked(updateQuestionTestable).mockResolvedValue({ id: "q1", testable: false } as never);
    const res = await action(
      makeActionArgs({ testable: false }, "PATCH", { Authorization: "Bearer svc-key" }),
    );
    expect(res.status).toBe(200);
    expect(getQuestionById).not.toHaveBeenCalled();
  });
});
