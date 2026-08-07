// @vitest-environment node
// #1213 — /api/canvas/$ catch-all: auth gate, the link-roster sub-route
// (own guard, rate limit, validation), the manage-integration gate (role +
// INSTRUCTOR policy), each GET/POST/DELETE branch, and the error-mapping
// switch at the bottom of handleCanvasRequest.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/canvas/client.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/canvas/client.server")>();
  return { ...actual };
});

vi.mock("~/lib/canvas/courses.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/canvas/courses.server")>();
  return {
    ...actual,
    listCanvasCoursesWithSyncState: vi.fn(),
    validateInstructorCanvasCourseIds: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("~/lib/canvas/guards.server", () => ({
  canLinkCanvasRoster: vi.fn(),
  canManageCanvasIntegration: vi.fn(),
  isCanvasLinkRosterRateLimited: vi.fn().mockReturnValue(false),
  isCanvasSyncRateLimited: vi.fn().mockReturnValue(false),
}));

vi.mock("~/lib/canvas/integration.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/canvas/integration.server")>();
  return {
    ...actual,
    deleteCanvasIntegration: vi.fn().mockResolvedValue(undefined),
    getCanvasIntegrationPublic: vi.fn(),
    saveCanvasIntegration: vi.fn(),
  };
});

vi.mock("~/lib/canvas/link-roster.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/canvas/link-roster.server")>();
  return { ...actual, linkCanvasRoster: vi.fn() };
});

vi.mock("~/lib/canvas/sync.server", () => ({
  syncCanvasCourses: vi.fn(),
}));

vi.mock("~/lib/policy.server", () => ({
  getPolicy: vi.fn().mockResolvedValue(true),
  logPolicyDenial: vi.fn(),
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn((p: Promise<unknown>) => p),
  logAuditAction: vi.fn().mockResolvedValue(undefined),
  logSecurityEvent: vi.fn().mockResolvedValue(undefined),
}));

import { loader, action } from "~/routes/api/canvas.$";
import { auth } from "~/lib/auth/server";
import { CanvasApiError, CanvasVerificationError } from "~/lib/canvas/client.server";
import {
  listCanvasCoursesWithSyncState,
  validateInstructorCanvasCourseIds,
  CanvasNotConnectedError,
  InvalidCanvasCourseAccessError,
} from "~/lib/canvas/courses.server";
import {
  canLinkCanvasRoster,
  canManageCanvasIntegration,
  isCanvasLinkRosterRateLimited,
  isCanvasSyncRateLimited,
} from "~/lib/canvas/guards.server";
import {
  deleteCanvasIntegration,
  getCanvasIntegrationPublic,
  saveCanvasIntegration,
  CanvasStoredCredentialsError,
} from "~/lib/canvas/integration.server";
import { linkCanvasRoster, LinkRosterError } from "~/lib/canvas/link-roster.server";
import { syncCanvasCourses } from "~/lib/canvas/sync.server";
import { getPolicy } from "~/lib/policy.server";

function makeArgs(path: string, method: string, body?: unknown) {
  return {
    request: new Request(`http://localhost/api/canvas${path}`, {
      method,
      ...(body !== undefined
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    }),
    params: {},
    context: {} as never,
  } as never;
}

async function call(path: string, method: string, body?: unknown) {
  return method === "GET" ? loader(makeArgs(path, method, body)) : action(makeArgs(path, method, body));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "u1", role: "INSTRUCTOR", email: "u1@ubc.ca" },
  } as never);
  vi.mocked(canManageCanvasIntegration).mockReturnValue(true);
  vi.mocked(getPolicy).mockResolvedValue(true);
  vi.mocked(canLinkCanvasRoster).mockReturnValue(true);
  vi.mocked(isCanvasLinkRosterRateLimited).mockReturnValue(false);
  vi.mocked(isCanvasSyncRateLimited).mockReturnValue(false);
});

describe("/api/canvas/$ auth + access gates", () => {
  it("returns 401 for anonymous callers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await call("/integration", "GET");
    expect(res.status).toBe(401);
  });

  it("returns 403 and logs CANVAS_ACCESS_DENIED when the role can't manage Canvas", async () => {
    vi.mocked(canManageCanvasIntegration).mockReturnValue(false);
    const res = await call("/integration", "GET");
    expect(res.status).toBe(403);
  });

  it("returns 403 for an INSTRUCTOR when the manage-Canvas policy is off", async () => {
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await call("/integration", "GET");
    expect(res.status).toBe(403);
  });
});

describe("/api/canvas/link-roster", () => {
  it("rejects non-POST methods with 405", async () => {
    const res = await call("/link-roster", "GET");
    expect(res.status).toBe(405);
  });

  it("returns 403 for a role that cannot link a roster (e.g. INSTRUCTOR)", async () => {
    vi.mocked(canLinkCanvasRoster).mockReturnValue(false);
    const res = await call("/link-roster", "POST", { studentNumber: "12345678" });
    expect(res.status).toBe(403);
  });

  it("returns 429 when rate-limited", async () => {
    vi.mocked(isCanvasLinkRosterRateLimited).mockReturnValue(true);
    const res = await call("/link-roster", "POST", { studentNumber: "12345678" });
    expect(res.status).toBe(429);
  });

  it("returns 400 for an invalid student number", async () => {
    const res = await call("/link-roster", "POST", { studentNumber: "" });
    expect(res.status).toBe(400);
  });

  it("links the roster and returns 200 on success", async () => {
    vi.mocked(linkCanvasRoster).mockResolvedValue({ studentId: "s1", enrollmentsLinked: 2 } as never);
    const res = await call("/link-roster", "POST", { studentNumber: "12345678" });
    expect(res.status).toBe(200);
  });

  it("maps a LinkRosterError to its statusCode", async () => {
    vi.mocked(linkCanvasRoster).mockRejectedValue(new LinkRosterError("no roster match", 404));
    const res = await call("/link-roster", "POST", { studentNumber: "12345678" });
    expect(res.status).toBe(404);
  });

  it("maps an unexpected error to 500", async () => {
    vi.mocked(linkCanvasRoster).mockRejectedValue(new Error("db down"));
    const res = await call("/link-roster", "POST", { studentNumber: "12345678" });
    expect(res.status).toBe(500);
  });
});

describe("GET /api/canvas/integration and /courses", () => {
  it("returns data:null when no integration is configured", async () => {
    vi.mocked(getCanvasIntegrationPublic).mockResolvedValue(null);
    const res = await call("/integration", "GET");
    const body = await res.json();
    expect(body).toEqual({ success: true, data: null, message: "Canvas integration not configured" });
  });

  it("returns the integration when configured", async () => {
    vi.mocked(getCanvasIntegrationPublic).mockResolvedValue({
      canvasUrl: "https://canvas.ubc.ca",
      isTestMode: false,
      isConnected: true,
    } as never);
    const res = await call("/integration", "GET");
    const body = await res.json();
    expect(body.data.canvasUrl).toBe("https://canvas.ubc.ca");
  });

  it("returns the course list for /courses", async () => {
    vi.mocked(listCanvasCoursesWithSyncState).mockResolvedValue([{ canvasId: "1" }] as never);
    const res = await call("/courses", "GET");
    const body = await res.json();
    expect(body.data.courses).toHaveLength(1);
  });

  it("returns 404 for an unrecognized GET subpath", async () => {
    const res = await call("/unknown", "GET");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/canvas/connect", () => {
  it("returns 400 for invalid JSON", async () => {
    const res = await action({
      request: new Request("http://localhost/api/canvas/connect", { method: "POST", body: "not json" }),
      params: {},
      context: {} as never,
    } as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 for a schema-invalid body", async () => {
    const res = await call("/connect", "POST", { canvasUrl: "not-a-url" });
    expect(res.status).toBe(400);
  });

  it("saves the integration and returns 200 on success", async () => {
    vi.mocked(saveCanvasIntegration).mockResolvedValue({
      canvasUrl: "https://canvas.ubc.ca",
      isTestMode: false,
      isConnected: true,
    } as never);
    const res = await call("/connect", "POST", {
      canvasUrl: "https://canvas.ubc.ca",
      isTestMode: true,
    });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/canvas/sync", () => {
  it("returns 429 when sync is rate-limited", async () => {
    vi.mocked(isCanvasSyncRateLimited).mockReturnValue(true);
    const res = await call("/sync", "POST", { canvasCourseIds: ["1"] });
    expect(res.status).toBe(429);
  });

  it("returns 400 for a schema-invalid body", async () => {
    const res = await call("/sync", "POST", { canvasCourseIds: "not-an-array" });
    expect(res.status).toBe(400);
  });

  it("validates course access and syncs on success", async () => {
    vi.mocked(syncCanvasCourses).mockResolvedValue({ synced: 1 } as never);
    const res = await call("/sync", "POST", { canvasCourseIds: ["1"] });
    expect(res.status).toBe(200);
    expect(validateInstructorCanvasCourseIds).toHaveBeenCalled();
  });

  it("returns 403 with invalidCourseIds when access validation fails", async () => {
    vi.mocked(validateInstructorCanvasCourseIds).mockRejectedValue(
      new InvalidCanvasCourseAccessError(["bad-1"]),
    );
    const res = await call("/sync", "POST", { canvasCourseIds: ["bad-1"] });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.invalidCourseIds).toEqual(["bad-1"]);
  });
});

describe("POST /api/canvas/<unknown>", () => {
  it("returns 404 for an unrecognized POST subpath", async () => {
    const res = await call("/bogus", "POST", {});
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/canvas/disconnect", () => {
  it("returns 404 for a non-disconnect DELETE subpath", async () => {
    const res = await call("/other", "DELETE");
    expect(res.status).toBe(404);
  });

  it("disconnects and returns 200", async () => {
    vi.mocked(getCanvasIntegrationPublic).mockResolvedValue({ canvasUrl: "https://canvas.ubc.ca" } as never);
    const res = await call("/disconnect", "DELETE");
    expect(res.status).toBe(200);
    expect(deleteCanvasIntegration).toHaveBeenCalledWith("u1");
  });
});

describe("unsupported method + error mapping", () => {
  it("returns 405 for an unsupported method on a manage-gated subpath", async () => {
    const res = await action(makeArgs("/integration", "PUT"));
    expect(res.status).toBe(405);
  });

  it("maps CanvasNotConnectedError to 400", async () => {
    vi.mocked(getCanvasIntegrationPublic).mockRejectedValue(new CanvasNotConnectedError());
    const res = await call("/integration", "GET");
    expect(res.status).toBe(400);
  });

  it("maps CanvasStoredCredentialsError to 400", async () => {
    vi.mocked(getCanvasIntegrationPublic).mockRejectedValue(new CanvasStoredCredentialsError());
    const res = await call("/integration", "GET");
    expect(res.status).toBe(400);
  });

  it("maps CanvasVerificationError to its statusCode", async () => {
    vi.mocked(getCanvasIntegrationPublic).mockRejectedValue(
      new CanvasVerificationError("bad creds", 502),
    );
    const res = await call("/integration", "GET");
    expect(res.status).toBe(502);
  });

  it("maps a CanvasApiError with statusCode 401 to 400", async () => {
    vi.mocked(getCanvasIntegrationPublic).mockRejectedValue(new CanvasApiError("unauthorized", 401));
    const res = await call("/integration", "GET");
    expect(res.status).toBe(400);
  });

  it("maps a CanvasApiError with a 5xx statusCode to 502", async () => {
    vi.mocked(getCanvasIntegrationPublic).mockRejectedValue(new CanvasApiError("upstream down", 503));
    const res = await call("/integration", "GET");
    expect(res.status).toBe(502);
  });

  it("maps an unrecognized thrown Error to a 500 with its message outside production", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    vi.mocked(getCanvasIntegrationPublic).mockRejectedValue(new Error("boom"));
    const res = await call("/integration", "GET");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("boom");
    process.env.NODE_ENV = originalEnv;
  });
});
