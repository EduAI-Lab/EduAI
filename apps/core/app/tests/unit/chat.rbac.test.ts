// @vitest-environment node
//
// §10 chat RBAC gate (#302): course-scoped POST /api/chat requires course
// access; students need an active enrollment and a published course.

import { describe, it, expect, vi, beforeEach } from "vitest";

const routingSettingsMock = vi.hoisted(() => ({
  getRoutingModelSettings: vi.fn(),
}));

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

vi.mock("~/lib/routing-model-settings.server", () => routingSettingsMock);

vi.mock("~/lib/prisma.server", () => ({
  default: {
    chat: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    course: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    user: { create: vi.fn(), findUnique: vi.fn() },
    externalUser: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("~/lib/policy.server", () => ({
  getPolicy: vi.fn(),
}));

import { action } from "~/routes/api/chat";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey, requireServiceKey } from "~/lib/auth/guards.server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import prisma from "~/lib/prisma.server";
import { getPolicy } from "~/lib/policy.server";
import { resetRateLimitsForTests } from "~/lib/auth/rate-limit.server";

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
  resetRateLimitsForTests();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "u1", role: "STUDENT" },
  } as never);
  routingSettingsMock.getRoutingModelSettings.mockResolvedValue({
    autoLlmEnabled: true,
    autoRulesEnabled: false,
  });
});

describe("POST /api/chat — §10 course gate (#302)", () => {
  it("returns 401 when unauthenticated and no service key", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await action(makeArgs({ messages: [], courseId: "c1" }));
    expect(res.status).toBe(401);
  });

  it("rejects the legacy auto-hybrid mode before course or model routing", async () => {
    const res = await action(
      makeArgs({ messages: [], model: "auto-hybrid", courseId: "c1" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Unsupported routing model",
      details:
        'The legacy "auto-hybrid" mode is disabled. Select Auto or Auto (rules) in chat.',
    });
    expect(resolveCourseAccessWithCourse).not.toHaveBeenCalled();
  });

  it("rejects Auto when the administrator disables LLM routing", async () => {
    routingSettingsMock.getRoutingModelSettings.mockResolvedValue({
      autoLlmEnabled: false,
      autoRulesEnabled: false,
    });

    const res = await action(
      makeArgs({ messages: [], model: "auto-llm", courseId: "c1" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "Routing model disabled",
    });
    expect(resolveCourseAccessWithCourse).not.toHaveBeenCalled();
  });

  it("rejects Auto (rules) when the administrator disables rule routing", async () => {
    const res = await action(
      makeArgs({ messages: [], model: "auto", courseId: "c1" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "Routing model disabled",
    });
    expect(resolveCourseAccessWithCourse).not.toHaveBeenCalled();
  });

  it("returns 404 when the course does not exist", async () => {
    mockAccess(null, null);
    const res = await action(makeArgs({ messages: [], courseId: "c1" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("returns 404 when the course was soft-deleted mid-chat (#225 RAG-09)", async () => {
    // Soft-deleted courses resolve the same as missing: { course: null, access: null }.
    vi.mocked(prisma.chat.findFirst).mockResolvedValue({
      id: "chat-soft-deleted",
      userId: "u1",
      courseId: "c1",
      chatbotType: null,
    } as never);
    mockAccess(null, null);
    const res = await action(
      makeArgs({
        messages: [{ id: "m1", role: "user", content: "Follow-up question" }],
        courseId: "c1",
        chatId: "chat-soft-deleted",
      }),
    );
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

  it("resolves compact courseCode via spaced candidate (COSC121 → COSC 121)", async () => {
    vi.mocked(prisma.course.findMany).mockResolvedValueOnce([
      { id: "c1", code: "COSC 121" },
    ] as never);
    mockAccess({ level: "student", rank: 0 });

    const res = await action(makeArgs({ messages: [], courseCode: "COSC121" }));
    expect(res.status).toBe(200);
    expect(prisma.course.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.course.findMany).toHaveBeenCalledWith({
      where: {
        code: { in: ["COSC121", "COSC 121"], mode: "insensitive" },
        deletedAt: null,
      },
      select: { id: true, code: true },
    });
    expect(resolveCourseAccessWithCourse).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      "c1",
    );
  });

  it("resolves an already-spaced courseCode on the first candidate", async () => {
    vi.mocked(prisma.course.findMany).mockResolvedValueOnce([
      { id: "c1", code: "COSC 121" },
    ] as never);
    mockAccess({ level: "student", rank: 0 });

    const res = await action(makeArgs({ messages: [], courseCode: "COSC 121" }));
    expect(res.status).toBe(200);
    expect(prisma.course.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.course.findMany).toHaveBeenCalledWith({
      where: {
        code: { in: ["COSC 121", "COSC121"], mode: "insensitive" },
        deletedAt: null,
      },
      select: { id: true, code: true },
    });
  });

  it("resolves courseCode case-insensitively (cosc121 → COSC 121)", async () => {
    vi.mocked(prisma.course.findMany).mockResolvedValueOnce([
      { id: "c1", code: "COSC 121" },
    ] as never);
    mockAccess({ level: "student", rank: 0 });

    const res = await action(makeArgs({ messages: [], courseCode: "cosc121" }));
    expect(res.status).toBe(200);
    expect(prisma.course.findMany).toHaveBeenCalledWith({
      where: {
        code: { in: ["cosc121", "cosc 121"], mode: "insensitive" },
        deletedAt: null,
      },
      select: { id: true, code: true },
    });
    expect(resolveCourseAccessWithCourse).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      "c1",
    );
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

  it("rejects a valid service key for admin chatMode", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    vi.mocked(requireServiceKey).mockResolvedValue(null);
    const args = makeArgs({ messages: [], chatMode: "admin" });
    args.request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-service-key",
      },
      body: JSON.stringify({ messages: [], chatMode: "admin" }),
    });

    const res = await action(args);

    expect(res.status).toBe(403);
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

// Edge-case audit #225 (RAG-03): chat isolation guards (foreign chatId,
// cross-course follow-up) were enforced in the route but untested there.
describe("POST /api/chat — chat isolation guards (#225 RAG-03)", () => {
  beforeEach(() => {
    // Reset the api-key guard to "no api-key session" so the acting user is the
    // STUDENT from getSession (other describe blocks leave an admin override).
    vi.mocked(enforceAdminIfApiKey).mockResolvedValue({ response: null, session: null });
  });

  it("returns 410 when the chatId does not belong to the acting user", async () => {
    // findFirst is ownership-scoped ({ id, userId }); a foreign/nonexistent
    // chat resolves to null and must not leak another user's history.
    vi.mocked(prisma.chat.findFirst).mockResolvedValue(null);

    const res = await action(
      makeArgs({ messages: [], chatId: "someone-elses-chat", courseId: "c1" }),
    );

    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "Chat not found", chatDeleted: true });
    // Blocked before course access is ever resolved.
    expect(resolveCourseAccessWithCourse).not.toHaveBeenCalled();
  });

  it("scopes the chat lookup to the acting user's id", async () => {
    vi.mocked(prisma.chat.findFirst).mockResolvedValue(null);

    await action(makeArgs({ messages: [], chatId: "chat-x", courseId: "c1" }));

    expect(prisma.chat.findFirst).toHaveBeenCalledWith({
      where: { id: "chat-x", userId: "u1" },
    });
  });

  it("returns 409 COURSE_MISMATCH when a follow-up turn names a different course", async () => {
    // A persisted chat is pinned to its course; switching would split RAG
    // context and history across courses.
    vi.mocked(prisma.chat.findFirst).mockResolvedValue({
      id: "chat-1",
      userId: "u1",
      courseId: "c1",
      chatbotType: null,
    } as never);

    const res = await action(
      makeArgs({ messages: [], chatId: "chat-1", courseId: "c2" }),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "COURSE_MISMATCH" });
    expect(resolveCourseAccessWithCourse).not.toHaveBeenCalled();
  });
});

describe("POST /api/chat — proxyUser delegation", () => {
  beforeEach(() => {
    // These tests drive `resolveProxyUser` directly, so they need a verified
    // admin API-key session (the only way to reach the proxyUser flow at all)
    // rather than the STUDENT cookie session from the outer `beforeEach`.
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "a1", role: "ADMIN" },
    } as never);
    vi.mocked(enforceAdminIfApiKey).mockResolvedValue({
      response: null,
      session: { user: { id: "a1", role: "ADMIN" } } as never,
    });
    vi.mocked(prisma.externalUser.findUnique).mockResolvedValue(null as never);
    vi.mocked(getPolicy).mockResolvedValue(true);
  });

  it("returns 403 when proxyUser is sent without a verified admin API key session", async () => {
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

  // Edge-case audit #225 (AUTH-01) [SECURITY]: `proxyUser.email` used to be
  // looked up against existing EduAI accounts and adopted wholesale — role
  // included — letting a delegating caller impersonate any instructor/admin
  // merely by naming their email. There must be no code path that resolves an
  // *existing* account by email alone.
  it("never inherits an existing instructor/admin's role via proxyUser.email (email alone cannot escalate)", async () => {
    // No (provider, externalUserId) mapping exists yet, so this is a "new
    // identity" resolution. Simulate the supplied email already belonging to
    // a real instructor account: user creation collides on the unique email
    // constraint instead of silently binding to (and inheriting) that account.
    vi.mocked(prisma.user.create).mockRejectedValue({ code: "P2002" });

    const res = await action(
      makeArgs({
        messages: [],
        courseId: "c1",
        proxyUser: {
          id: "external-1",
          provider: "aitutor",
          email: "real-instructor@ubc.ca",
        },
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Failed to resolve proxy user");
    // Never binds to the colliding account, so course access is never
    // resolved against it (i.e., never runs as the instructor).
    expect(resolveCourseAccessWithCourse).not.toHaveBeenCalled();
    // The only lookup performed is the (provider, externalUserId) mapping —
    // there is no email-based user lookup that could adopt an existing role.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  // AUTH-03 [SECURITY]: auto-creating a brand-new proxy user is account
  // creation and must clear the same bar as self-registration.
  it("refuses to auto-create a proxy user with a non-UBC email (fail-closed)", async () => {
    const res = await action(
      makeArgs({
        messages: [],
        courseId: "c1",
        proxyUser: { id: "external-2", provider: "aitutor", email: "student@gmail.com" },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Failed to resolve proxy user");
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("refuses to auto-create a proxy user with no email at all (fail-closed)", async () => {
    const res = await action(
      makeArgs({
        messages: [],
        courseId: "c1",
        proxyUser: { id: "external-3", provider: "aitutor" },
      }),
    );
    expect(res.status).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("refuses to auto-create a proxy user while auth.allowPublicRegistration is off, even with a UBC email", async () => {
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await action(
      makeArgs({
        messages: [],
        courseId: "c1",
        proxyUser: { id: "external-4", provider: "aitutor", email: "new-student@student.ubc.ca" },
      }),
    );
    expect(res.status).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("creates a least-privilege STUDENT proxy identity for a vetted new UBC email", async () => {
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "new-proxy-user",
      email: "new-student@student.ubc.ca",
      name: "new-student@student.ubc.ca",
      role: "STUDENT",
      isActive: true,
    } as never);
    vi.mocked(prisma.externalUser.create).mockResolvedValue({} as never);
    mockAccess({ level: "student", rank: 0 });

    const res = await action(
      makeArgs({
        messages: [],
        courseId: "c1",
        proxyUser: { id: "external-5", provider: "aitutor", email: "new-student@student.ubc.ca" },
      }),
    );

    expect(res.status).toBe(200);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: "new-student@student.ubc.ca",
        name: "new-student@student.ubc.ca",
        role: "STUDENT",
        isActive: true,
      },
    });
    expect(resolveCourseAccessWithCourse).toHaveBeenCalledWith(
      expect.objectContaining({ id: "new-proxy-user", role: "STUDENT" }),
      "c1",
    );
  });

  it("reuses the existing (provider, externalUserId) mapping's user without any email lookup", async () => {
    vi.mocked(prisma.externalUser.findUnique).mockResolvedValue({
      id: "mapping-1",
      provider: "aitutor",
      externalUserId: "external-6",
      email: "existing@student.ubc.ca",
      user: {
        id: "mapped-user",
        email: "existing@student.ubc.ca",
        name: "existing@student.ubc.ca",
        role: "STUDENT",
        isActive: true,
      },
    } as never);
    mockAccess({ level: "student", rank: 0 });

    const res = await action(
      makeArgs({
        messages: [],
        courseId: "c1",
        proxyUser: { id: "external-6", provider: "aitutor", email: "existing@student.ubc.ca" },
      }),
    );

    expect(res.status).toBe(200);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(resolveCourseAccessWithCourse).toHaveBeenCalledWith(
      expect.objectContaining({ id: "mapped-user", role: "STUDENT" }),
      "c1",
    );
  });
});
