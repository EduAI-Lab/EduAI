// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const findManyMock = vi.hoisted(() => vi.fn());
const resolveStatusHostsMock = vi.hoisted(() => vi.fn());

vi.mock("~/lib/prisma.server", () => ({
  default: { aiServiceSample: { findMany: findManyMock } },
}));
vi.mock("~/lib/ai/status/hosts.server", () => ({
  resolveStatusHosts: resolveStatusHostsMock,
}));

const { loadHistoryPayload } = await import("~/lib/ai/status/history.server");

beforeEach(() => {
  vi.clearAllMocks();
  findManyMock.mockResolvedValue([]);
  resolveStatusHostsMock.mockReturnValue([
    { serverId: "host-01", baseUrl: "http://a", models: [] },
  ]);
});

describe("loadHistoryPayload", () => {
  it("defaults to a 72-hour window", async () => {
    const payload = await loadHistoryPayload({});
    expect(payload.windowHours).toBe(72);
  });

  it("clamps a request longer than retention can serve", async () => {
    // 168h is the longest window the endpoint will serve; anything beyond it
    // would render as grey and read as downtime rather than as configuration.
    const payload = await loadHistoryPayload({ hours: 9999 });
    expect(payload.windowHours).toBe(168);
  });

  it("falls back to the default for a window that is not a positive number", async () => {
    expect((await loadHistoryPayload({ hours: Number.NaN })).windowHours).toBe(72);
    expect((await loadHistoryPayload({ hours: -5 })).windowHours).toBe(72);
    expect((await loadHistoryPayload({ hours: 0 })).windowHours).toBe(72);
  });

  it("reads only samples inside the requested window", async () => {
    const now = new Date("2026-09-19T12:00:00.000Z");
    await loadHistoryPayload({ hours: 24, now });

    const where = findManyMock.mock.calls[0][0].where;
    expect(where.observedAt.gte).toEqual(new Date("2026-09-18T12:00:00.000Z"));
  });

  it("reports the hosts that still exist so a decommissioned one is not labelled live", async () => {
    // `bucketSamples` needs the live ids to assign stable "Server NN" labels;
    // losing them would re-point historical bars at a different machine.
    await loadHistoryPayload({});
    expect(resolveStatusHostsMock).toHaveBeenCalled();
  });

  it("buckets the rows it reads into per-model series", async () => {
    const now = new Date("2026-09-19T12:00:00.000Z");
    findManyMock.mockResolvedValue([
      {
        serverId: "host-01",
        modelId: "qwen3.5-9b-instruct",
        state: "OPERATIONAL",
        reachable: true,
        waiting: 1,
        cacheUsage: 0.2,
        intervalMinutes: 15,
        observedAt: new Date("2026-09-19T11:30:00.000Z"),
      },
    ]);

    const payload = await loadHistoryPayload({ hours: 24, now });

    expect(payload.servers).toHaveLength(1);
    expect(payload.servers[0].models[0].label).toBe("Qwen:9b-01");
    expect(payload.servers[0].models[0].uptimePct).toBe(100);
  });
});
