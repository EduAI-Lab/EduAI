// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const getRequestSessionMock = vi.hoisted(() => vi.fn());
const loadHistoryPayloadMock = vi.hoisted(() => vi.fn());

vi.mock("~/lib/auth/request-session.server", () => ({
  getRequestSession: getRequestSessionMock,
}));
vi.mock("~/lib/ai/status/history.server", () => ({
  loadHistoryPayload: loadHistoryPayloadMock,
}));

const { loader } = await import("~/routes/api/ai-status.history");

const payload = {
  windowHours: 72,
  bucketMinutes: 60,
  generatedAt: "2026-09-19T12:00:00.000Z",
  servers: [],
};

function request(url = "http://localhost/api/ai-status/history") {
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  getRequestSessionMock.mockResolvedValue({ user: { id: "u1" } });
  loadHistoryPayloadMock.mockResolvedValue(payload);
});

describe("GET /api/ai-status/history", () => {
  it("401s without a session", async () => {
    // The sibling /api/ai-status has this gate asserted; this endpoint serves
    // the same data over a longer window and must not be the open one.
    getRequestSessionMock.mockResolvedValue(null);

    const res = await loader({ request: request() } as never);

    expect(res.status).toBe(401);
    expect(loadHistoryPayloadMock).not.toHaveBeenCalled();
  });

  it("serves any signed-in user — status is not a privileged surface", async () => {
    const res = await loader({ request: request() } as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
  });

  it("passes the caller's requested window through to the reader", async () => {
    await loader({ request: request("http://localhost/api/ai-status/history?hours=24") } as never);
    expect(loadHistoryPayloadMock).toHaveBeenCalledWith({ hours: 24 });
  });

  it("lets the reader decide the default when no window is asked for", async () => {
    // `Number(null)` is 0, which `loadHistoryPayload` rejects in favour of its
    // own default — the clamp lives in one place, not two.
    await loader({ request: request() } as never);
    expect(loadHistoryPayloadMock).toHaveBeenCalledWith({ hours: 0 });
  });

  it("marks the response private so a shared cache cannot serve one user's view to another", async () => {
    const res = await loader({ request: request() } as never);
    expect(res.headers.get("Cache-Control")).toMatch(/private/);
  });
});
