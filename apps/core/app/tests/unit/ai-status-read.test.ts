// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveStatusHostsMock = vi.hoisted(() => vi.fn());
const findManyMock = vi.hoisted(() => vi.fn());

vi.mock("~/lib/ai/status/hosts.server", () => ({ resolveStatusHosts: resolveStatusHostsMock }));
vi.mock("~/lib/prisma.server", () => ({
  default: { aiServiceSample: { findMany: findManyMock } },
}));

const { deriveRowState, isStale, collapseToHostProbes, getUbcStatusFromSamples } =
  await import("~/lib/ai/status/read.server");

const THRESHOLDS = { waiting: 4, cachePct: 0.9 };

function sample(over: Partial<Parameters<typeof deriveRowState>[0]> = {}) {
  return {
    serverId: "cmps01",
    modelId: "m",
    state: "OPERATIONAL",
    reachable: true,
    waiting: 0,
    cacheUsage: 0.1,
    intervalMinutes: 15,
    observedAt: new Date(),
    ...over,
  } as Parameters<typeof deriveRowState>[0];
}

describe("deriveRowState", () => {
  it("maps a healthy reachable sample to operational", () => {
    expect(deriveRowState(sample(), THRESHOLDS)).toBe("operational");
  });

  it("degrades a reachable host over the waiting threshold", () => {
    expect(deriveRowState(sample({ waiting: 5 }), THRESHOLDS)).toBe("degraded");
  });

  it("degrades a reachable host over the cache threshold", () => {
    expect(deriveRowState(sample({ cacheUsage: 0.95 }), THRESHOLDS)).toBe("degraded");
  });

  it("does not degrade exactly at the threshold", () => {
    expect(deriveRowState(sample({ waiting: 4, cacheUsage: 0.9 }), THRESHOLDS)).toBe("operational");
  });

  it("treats unknown load as not degraded", () => {
    expect(deriveRowState(sample({ waiting: null, cacheUsage: null }), THRESHOLDS)).toBe(
      "operational",
    );
  });

  it("passes OUTAGE and UNKNOWN through regardless of load", () => {
    expect(deriveRowState(sample({ state: "OUTAGE", reachable: false }), THRESHOLDS)).toBe(
      "outage",
    );
    expect(deriveRowState(sample({ state: "UNKNOWN", reachable: false }), THRESHOLDS)).toBe(
      "unknown",
    );
  });
});

describe("isStale", () => {
  const now = new Date("2026-09-18T12:00:00Z");

  it("is not stale within 3x the sample's own interval", () => {
    expect(isStale(new Date("2026-09-18T11:30:00Z"), 15, now)).toBe(false);
  });

  it("is stale past 3x the sample's own interval", () => {
    expect(isStale(new Date("2026-09-18T11:00:00Z"), 15, now)).toBe(true);
  });

  it("uses the sample's interval, not a fixed 15 minutes", () => {
    // An admin retuned the job to 60 min; 50 minutes old is fresh, not stale.
    expect(isStale(new Date("2026-09-18T11:10:00Z"), 60, now)).toBe(false);
  });

  it("treats no samples at all as stale", () => {
    expect(isStale(null, 15, now)).toBe(true);
  });
});

describe("collapseToHostProbes", () => {
  it("collapses a host to reachable if any of its model rows is reachable", () => {
    const probes = collapseToHostProbes([
      sample({ serverId: "h1", modelId: "a", reachable: false, waiting: null, cacheUsage: null }),
      sample({ serverId: "h1", modelId: "b", reachable: true, waiting: 1, cacheUsage: 0.2 }),
    ]);
    expect(probes).toHaveLength(1);
    expect(probes[0].reachable).toBe(true);
  });

  it("yields load: null when all of a host's rows have unknown load", () => {
    const probes = collapseToHostProbes([
      sample({ serverId: "h1", modelId: "a", waiting: null, cacheUsage: null }),
      sample({ serverId: "h1", modelId: "b", waiting: null, cacheUsage: null }),
    ]);
    expect(probes).toHaveLength(1);
    expect(probes[0].load).toBeNull();
  });

  it("surfaces a load value even if only some of a host's rows carry it", () => {
    const probes = collapseToHostProbes([
      sample({ serverId: "h1", modelId: "a", waiting: null, cacheUsage: null }),
      sample({ serverId: "h1", modelId: "b", waiting: 3, cacheUsage: 0.5 }),
    ]);
    expect(probes).toHaveLength(1);
    expect(probes[0].load).toEqual({ waiting: 3, cacheUsage: 0.5 });
  });

  it("keeps multiple hosts separate", () => {
    const probes = collapseToHostProbes([
      sample({ serverId: "h1", modelId: "a" }),
      sample({ serverId: "h2", modelId: "a" }),
    ]);
    expect(probes).toHaveLength(2);
  });
});

describe("getUbcStatusFromSamples", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveStatusHostsMock.mockReturnValue([
      { serverId: "cmps01", baseUrl: "x", configuredModels: [] },
    ]);
  });

  it("uses the newest row's own intervalMinutes, not samples[0]'s", async () => {
    // samples[0] is NOT the newest row: it is older (10:00) and carries a
    // 60-minute interval (180-minute horizon). The true newest row (11:10)
    // carries a 15-minute interval (45-minute horizon). At now=12:00 the
    // newest row is 50 minutes old: stale under its own 45-minute horizon,
    // but wrongly "fresh" if the reader used samples[0]'s 180-minute horizon
    // instead. Reading intervalMinutes off samples[0] must fail this test.
    const older = sample({
      serverId: "cmps01",
      modelId: "a",
      intervalMinutes: 60,
      observedAt: new Date("2026-09-18T10:00:00Z"),
    });
    const newest = sample({
      serverId: "cmps01",
      modelId: "b",
      intervalMinutes: 15,
      observedAt: new Date("2026-09-18T11:10:00Z"),
    });
    findManyMock.mockResolvedValue([older, newest]);

    vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
    const result = await getUbcStatusFromSamples();
    vi.useRealTimers();

    expect(result.stale).toBe(true);
    expect(result.checkedAt).toBe(newest.observedAt.toISOString());
  });
});
