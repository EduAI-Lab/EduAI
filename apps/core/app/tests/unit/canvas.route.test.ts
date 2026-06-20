// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/policy.server", () => ({
  getPolicy: vi.fn(),
  logPolicyDenial: vi.fn(),
}));

// Canvas guard: pure role check. Default allow; tests override as needed.
vi.mock("~/lib/canvas/guards.server", () => ({
  canManageCanvasIntegration: vi.fn(() => true),
  canLinkCanvasRoster: vi.fn(() => false),
  isCanvasLinkRosterRateLimited: vi.fn(() => false),
  isCanvasSyncRateLimited: vi.fn(() => false),
}));

vi.mock("~/lib/canvas/integration.server", () => ({
  getCanvasIntegrationPublic: vi.fn().mockResolvedValue(null),
  saveCanvasIntegration: vi.fn(),
  deleteCanvasIntegration: vi.fn(),
}));

vi.mock("~/lib/canvas/courses.server", () => ({
  CanvasNotConnectedError: class extends Error {},
  InvalidCanvasCourseAccessError: class extends Error {},
  listCanvasCoursesWithSyncState: vi.fn(),
  validateInstructorCanvasCourseIds: vi.fn(),
}));

vi.mock("~/lib/canvas/client.server", () => ({
  CanvasApiError: class extends Error {},
  CanvasVerificationError: class extends Error {},
}));

vi.mock("~/lib/canvas/link-roster.server", () => ({
  LinkRosterError: class extends Error {},
  linkCanvasRoster: vi.fn(),
}));

vi.mock("~/lib/canvas/sync.server", () => ({ syncCanvasCourses: vi.fn() }));

vi.mock("~/lib/canvas/schemas", () => ({
  ConnectCanvasSchema: { safeParse: vi.fn() },
  LinkRosterSchema: { safeParse: vi.fn() },
  SyncCanvasCoursesSchema: { safeParse: vi.fn() },
}));

import { loader } from "~/routes/api/canvas.$";
import { auth } from "~/lib/auth/server";
import { getPolicy } from "~/lib/policy.server";

function getArgs(role: string) {
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role } } as never);
  return {
    request: new Request("http://localhost/api/canvas/integration"),
    params: {},
    context: {} as never,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("instructors.canManageCanvasIntegration gate", () => {
  it("returns 403 for an INSTRUCTOR when the flag is off", async () => {
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await loader(getArgs("INSTRUCTOR"));
    expect(res.status).toBe(403);
    expect(getPolicy).toHaveBeenCalledWith("instructors.canManageCanvasIntegration");
  });

  it("admits an INSTRUCTOR when the flag is on (reaches the integration handler)", async () => {
    vi.mocked(getPolicy).mockResolvedValue(true);
    const res = await loader(getArgs("INSTRUCTOR"));
    expect(res.status).toBe(200);
  });

  it("ADMIN is unaffected by the flag (200 even when off)", async () => {
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await loader(getArgs("ADMIN"));
    expect(res.status).toBe(200);
    // The instructor-only gate never consults the policy for ADMIN.
    expect(getPolicy).not.toHaveBeenCalled();
  });
});
