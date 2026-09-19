// @vitest-environment node
import { describe, it, expect } from "vitest";
import { deriveRowState, isStale } from "~/lib/ai/status/read.server";

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
