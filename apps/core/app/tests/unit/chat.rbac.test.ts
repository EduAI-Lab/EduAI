// @vitest-environment node
//
// §10 chat RBAC gate (#302): course-scoped POST /api/chat requires course
// access; students need an active enrollment and a published course.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn().mockResolvedValue({ response: null, session: null }),
  requireServiceKey: vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ error: "MISSING_SERVICE_KEY" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }),
  ),
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    chat: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    course: { findFirst: vi.fn() },
  },
}));

import { action } from "~/routes/api/chat";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey, requireServiceKey } from "~/lib/auth/guards.server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";

const COURSE = { id: "c1", isPublished: true, department: null };

type Access = { level: string; rank: number } | null;

function mockAccess(access: Access, course: object | null = COURSE) {
  vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
    course: course as never,
    access: access as never,
  });
}

function makeArgs(body: object) {
  return {
    request: new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: {},
    context: {} as never,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "u1", role: "STUDENT" },
  } as never);
});

describe("POST /api/chat — §10 course gate (#302)", () => {
  it("returns 401 when unauthenticated and no service key", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await action(makeArgs({ messages: [], courseId: "c1" }));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the course does not exist", async () => {
    mockAccess(null, null);
    const res = await action(makeArgs({ messages: [], courseId: "c1" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("returns 403 when the caller has no course relationship", async () => {
    mockAccess(null);
    const res = await action(makeArgs({ messages: [], courseId: "c1" }));
    expect(res.status).toBe(403);
  });

  it("returns 403 for an enrolled student when the course is unpublished (§10)", async () => {
    mockAccess({ level: "student", rank: 0 }, { ...COURSE, isPublished: false });
    const res = await action(makeArgs({ messages: [], courseId: "c1" }));
    expect(res.status).toBe(403);
  });

  it("returns 403 for a student whose enrollment is inactive (resolver returns null)", async () => {
    // An inactive enrollment resolves to null access — blocked on POST while
    // own-history GET (ownership-scoped) remains unaffected.
    mockAccess(null);
    const res = await action(makeArgs({ messages: [], courseId: "c1" }));
    expect(res.status).toBe(403);
  });

  it("admits an enrolled student in a published course", async () => {
    mockAccess({ level: "student", rank: 0 });
    // Empty body → early 200 { chatId: null } without touching AI providers.
    const res = await action(makeArgs({ messages: [], courseId: "c1" }));
    expect(res.status).toBe(200);
    expect((await res.json()).chatId).toBeNull();
  });

  it("admits a TA even when the course is unpublished", async () => {
    mockAccess({ level: "ta", rank: 1 }, { ...COURSE, isPublished: false });
    const res = await action(makeArgs({ messages: [], courseId: "c1" }));
    expect(res.status).toBe(200);
  });

  it("rejects an interactive chat with no course context (global chat removed, #657)", async () => {
    const res = await action(makeArgs({ messages: [] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "COURSE_REQUIRED" });
    expect(resolveCourseAccessWithCourse).not.toHaveBeenCalled();
  });

  it("still allows a server-to-server (service-key) caller to omit a course", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    vi.mocked(requireServiceKey).mockResolvedValue(null); // valid service key
    const res = await action(makeArgs({ messages: [] }));
    expect(res.status).toBe(200);
    expect(resolveCourseAccessWithCourse).not.toHaveBeenCalled();
  });
});

describe("POST /api/chat — admin chatMode gate", () => {
  it("returns 403 when non-admin requests admin chatMode", async () => {
    const res = await action(makeArgs({ messages: [], chatMode: "admin" }));
    expect(res.status).toBe(403);
  });

  it("admits ADMIN for admin chatMode without course context", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "a1", role: "ADMIN" },
    } as never);
    const res = await action(makeArgs({ messages: [], chatMode: "admin" }));
    expect(res.status).toBe(200);
  });

  it("admits a verified ADMIN API key for admin chatMode without course context", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    vi.mocked(enforceAdminIfApiKey).mockResolvedValue({
      response: null,
      session: { user: { id: "a1", role: "ADMIN" } } as never,
    });
    const res = await action(makeArgs({ messages: [], chatMode: "admin" }));
    expect(res.status).toBe(200);
    expect(requireServiceKey).not.toHaveBeenCalled();
    expect(resolveCourseAccessWithCourse).not.toHaveBeenCalled();
  });
});

describe("POST /api/chat — proxyUser delegation", () => {
  it("returns 403 when proxyUser is sent without a verified admin API key session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "a1", role: "ADMIN" },
    } as never);
    vi.mocked(enforceAdminIfApiKey).mockResolvedValue({ response: null, session: null });
    mockAccess({ level: "admin", rank: 3 });
    const res = await action(
      makeArgs({
        messages: [],
        courseId: "c1",
        proxyUser: { id: "student-1", provider: "aitutor" },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "proxyUser requires admin API key access" });
  });
});
