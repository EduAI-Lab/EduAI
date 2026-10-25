// @vitest-environment node
/**
 * #1958: `GET /api/assistant/gate`, the extensions' render condition for Penny.
 * - no session is a 401;
 * - the snapshot comes from the same gate as the root loader;
 * - a course id is a hint: resolved for this reader, never echoed back unchecked;
 * - a settings read failure hides the assistant instead of failing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth/server", () => ({ auth: { api: { getSession: vi.fn() } } }));

const rateMock = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
vi.mock("~/lib/auth/rate-limit.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth/rate-limit.server")>()),
  checkRateLimit: rateMock.checkRateLimit,
}));

const gateMock = vi.hoisted(() => ({ loadAssistantAvailability: vi.fn() }));
vi.mock("~/lib/assistant/assistant-gate.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/assistant/assistant-gate.server")>()),
  loadAssistantAvailability: gateMock.loadAssistantAvailability,
}));

const contextMock = vi.hoisted(() => ({ resolvePageContext: vi.fn() }));
vi.mock("~/lib/assistant/material-context.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/assistant/material-context.server")>()),
  resolvePageContext: contextMock.resolvePageContext,
}));

import { auth } from "~/lib/auth/server";
import { defaultAssistantSettings } from "~/lib/assistant/assistant-settings";
import { loader } from "~/routes/api/assistant.gate";

function get(query = "") {
  return { request: new Request(`http://localhost/api/assistant/gate${query}`) } as never;
}

function signIn(role: string) {
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "u1", role, email: "u1@example.com" },
  } as never);
}

const resolvedCourse = {
  kind: "resolved",
  courseId: "c1",
  courseLabel: "CS101 — Intro",
  courseAllowsAi: true,
  access: { level: "instructor", rank: 2 },
  canView: true,
  material: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  rateMock.checkRateLimit.mockResolvedValue({ limited: false, retryAfter: 0 });
  gateMock.loadAssistantAvailability.mockResolvedValue({
    settings: { ...defaultAssistantSettings(), enableHelpAssistant: true },
    hasEnabledProvider: true,
    catalogue: [],
  });
  contextMock.resolvePageContext.mockResolvedValue({ kind: "none" });
});

describe("GET /api/assistant/gate", () => {
  it("is a 401 without a session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = (await loader(get())) as Response;
    expect(res.status).toBe(401);
  });

  it("returns the gate snapshot and the caller's platform identity", async () => {
    signIn("STUDENT");
    const res = (await loader(get())) as Response;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      gate: { mounted: true, docs: true },
      user: { id: "u1", role: "STUDENT" },
      context: null,
    });
  });

  it("hides the assistant when Penny is off", async () => {
    signIn("INSTRUCTOR");
    gateMock.loadAssistantAvailability.mockResolvedValue({
      settings: defaultAssistantSettings(),
      hasEnabledProvider: true,
      catalogue: [],
    });
    const body = await ((await loader(get())) as Response).json();
    expect(body.gate).toEqual({ mounted: false, docs: false });
  });

  it("hides the assistant when the settings read fails", async () => {
    signIn("STUDENT");
    gateMock.loadAssistantAvailability.mockRejectedValue(new Error("db down"));
    const res = (await loader(get("?courseId=c1"))) as Response;
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      gate: { mounted: false, docs: false },
      context: null,
    });
  });

  it("resolves a course hint for this reader and grants the course's staff material scope", async () => {
    signIn("INSTRUCTOR");
    contextMock.resolvePageContext.mockResolvedValue(resolvedCourse);
    const body = await ((await loader(get("?courseId=c1"))) as Response).json();
    expect(contextMock.resolvePageContext).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      { courseId: "c1", materialId: null },
    );
    expect(body.context).toEqual({
      courseId: "c1",
      materialId: null,
      label: "CS101 — Intro",
      materialScope: true,
    });
  });

  it("gives a reader who can't view the course's materials no material scope", async () => {
    signIn("STUDENT");
    contextMock.resolvePageContext.mockResolvedValue({
      ...resolvedCourse,
      access: { level: "student", rank: 1 },
      canView: false,
    });
    const body = await ((await loader(get("?courseId=c1"))) as Response).json();
    expect(body.context).toMatchObject({ courseId: "c1", materialScope: false });
  });

  it("drops a malformed course id before any lookup", async () => {
    signIn("STUDENT");
    const body = await ((await loader(get("?courseId=../etc"))) as Response).json();
    expect(contextMock.resolvePageContext).toHaveBeenCalledWith(expect.anything(), null);
    expect(body.context).toBeNull();
  });

  it("returns no context for a course that doesn't exist", async () => {
    signIn("STUDENT");
    contextMock.resolvePageContext.mockResolvedValue({ kind: "missing" });
    const body = await ((await loader(get("?courseId=nope"))) as Response).json();
    expect(body.context).toBeNull();
  });

  it("is throttled per user", async () => {
    signIn("STUDENT");
    rateMock.checkRateLimit.mockResolvedValue({ limited: true, retryAfter: 30 });
    const res = (await loader(get())) as Response;
    expect(res.status).toBe(429);
  });
});
