// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const getRequestSessionMock = vi.hoisted(() => vi.fn());
const loadHistoryPayloadMock = vi.hoisted(() => vi.fn());
const getUbcStatusCachedMock = vi.hoisted(() => vi.fn());

vi.mock("~/lib/auth/request-session.server", () => ({
  getRequestSession: getRequestSessionMock,
}));
vi.mock("~/lib/ai/status/history.server", () => ({
  loadHistoryPayload: loadHistoryPayloadMock,
}));
vi.mock("~/lib/ai/status/read.server", () => ({
  getUbcStatusCached: getUbcStatusCachedMock,
}));

const { loader } = await import("~/routes/status");

/** The loader's success shape — everything it returns that is not a redirect. */
type LoaderData = Exclude<Awaited<ReturnType<typeof loader>>, Response>;

const emptyPayload: LoaderData["payload"] = {
  windowHours: 72,
  bucketMinutes: 60,
  generatedAt: "2026-09-19T12:00:00.000Z",
  servers: [],
};

function request() {
  return new Request("http://localhost/status");
}

beforeEach(() => {
  vi.clearAllMocks();
  getRequestSessionMock.mockResolvedValue({ user: { id: "u1", role: "STUDENT" } });
  loadHistoryPayloadMock.mockResolvedValue(emptyPayload);
  getUbcStatusCachedMock.mockResolvedValue({
    status: { state: "operational" },
    checkedAt: "2026-09-19T11:58:00.000Z",
    stale: false,
  });
});

describe("GET /status", () => {
  it("sends a signed-out visitor to the login page", async () => {
    getRequestSessionMock.mockResolvedValue(null);

    const res = (await loader({ request: request() } as never)) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/login");
  });

  it("serves any signed-in user — status is not a privileged surface", async () => {
    const data = await loader({ request: request() } as never);
    expect(data).toMatchObject({ user: { id: "u1" } });
  });

  it("renders the same snapshot the header chip reads, with its freshness", async () => {
    const data = (await loader({ request: request() } as never)) as LoaderData;

    expect(data.ubc).toEqual({ state: "operational" });
    expect(data.checkedAt).toBe("2026-09-19T11:58:00.000Z");
    expect(data.stale).toBe(false);
    expect(data.payload).toEqual(emptyPayload);
  });

  it("asks for the 72-hour window the page advertises", async () => {
    await loader({ request: request() } as never);
    expect(loadHistoryPayloadMock).toHaveBeenCalledWith({ hours: 72 });
  });

  it("passes the stale verdict through instead of hiding a dead probe", async () => {
    getUbcStatusCachedMock.mockResolvedValue({
      status: { state: "unknown", detail: "Status data is stale — last checked 47 minutes ago." },
      checkedAt: "2026-09-19T11:13:00.000Z",
      stale: true,
    });

    const data = (await loader({ request: request() } as never)) as LoaderData;
    expect(data.stale).toBe(true);
  });
});
