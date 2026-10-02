// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const getRequestSessionMock = vi.hoisted(() => vi.fn());
const getUbcStatusCachedMock = vi.hoisted(() => vi.fn());

vi.mock("~/lib/auth/request-session.server", () => ({
  getRequestSession: getRequestSessionMock,
}));
// The route reads through the 60s single-flight cache, not the raw query.
vi.mock("~/lib/ai/status/read.server", () => ({
  getUbcStatusCached: getUbcStatusCachedMock,
}));

const { loader } = await import("~/routes/api/ai-status");

function request() {
  return new Request("http://localhost/api/ai-status");
}

beforeEach(() => {
  vi.clearAllMocks();
  getRequestSessionMock.mockResolvedValue({ user: { id: "u1" } });
});

describe("GET /api/ai-status", () => {
  it("401s without a session", async () => {
    getRequestSessionMock.mockResolvedValue(null);
    const res = await loader({ request: request() } as never);
    expect(res.status).toBe(401);
  });

  it("returns the persisted UBC status with checkedAt and stale", async () => {
    getUbcStatusCachedMock.mockResolvedValue({
      status: {
        state: "degraded",
        detail: "UBC-hosted inference degraded: heavy load — 6 queued.",
      },
      checkedAt: "2026-09-18T20:15:00.000Z",
      stale: false,
    });

    const res = await loader({ request: request() } as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ubc).toEqual({
      state: "degraded",
      detail: "UBC-hosted inference degraded: heavy load — 6 queued.",
    });
    expect(body.checkedAt).toBe("2026-09-18T20:15:00.000Z");
    expect(body.stale).toBe(false);
    expect(body.cloud).toBeDefined();
  });

  it("reports unknown and stale when the probe has stopped running", async () => {
    getUbcStatusCachedMock.mockResolvedValue({
      status: { state: "unknown", detail: "Status data is stale — last checked 47 minutes ago." },
      checkedAt: "2026-09-18T19:13:00.000Z",
      stale: true,
    });

    const res = await loader({ request: request() } as never);
    const body = await res.json();

    expect(body.ubc.state).toBe("unknown");
    expect(body.stale).toBe(true);
  });
});
