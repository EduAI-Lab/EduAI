// @vitest-environment node
import { describe, it, expect } from "vitest";
import { bucketSamples } from "~/lib/ai/status/history.server";
import type { LatestSample } from "~/lib/ai/status/read.server";

const NOW = new Date("2026-09-18T12:00:00Z");
const THRESHOLDS = { waiting: 4, cachePct: 0.9 };

function s(over: Partial<LatestSample>): LatestSample {
  return {
    serverId: "cmps01",
    modelId: "qwen3.5-9b-instruct",
    state: "OPERATIONAL",
    reachable: true,
    waiting: 0,
    cacheUsage: 0.1,
    intervalMinutes: 15,
    observedAt: NOW,
    ...over,
  };
}

describe("bucketSamples", () => {
  it("labels servers and models without leaking internal ids", () => {
    const out = bucketSamples([s({})], {
      windowHours: 2,
      now: NOW,
      thresholds: THRESHOLDS,
      liveServerIds: ["cmps01"],
    });

    expect(out.servers[0].label).toBe("Server 01");
    expect(out.servers[0].key).toBe("server-01");
    expect(out.servers[0].models[0].label).toBe("Qwen:9b-01");
    expect(JSON.stringify(out)).not.toContain("cmps01");
    expect(JSON.stringify(out)).not.toContain("qwen3.5-9b-instruct");
  });

  it("renders a bucket with no samples as null, not operational", () => {
    const out = bucketSamples([s({ observedAt: new Date("2026-09-18T11:30:00Z") })], {
      windowHours: 3,
      now: NOW,
      thresholds: THRESHOLDS,
      liveServerIds: ["cmps01"],
    });

    const buckets = out.servers[0].models[0].buckets;
    expect(buckets).toHaveLength(3);
    expect(buckets[0].state).toBeNull();
    expect(buckets[1].state).toBeNull();
    expect(buckets[2].state).toBe("operational");
  });

  it("takes the worst state in a bucket", () => {
    const out = bucketSamples(
      [
        s({ observedAt: new Date("2026-09-18T11:05:00Z") }),
        s({
          observedAt: new Date("2026-09-18T11:20:00Z"),
          state: "OUTAGE",
          reachable: false,
          waiting: null,
          cacheUsage: null,
        }),
        s({ observedAt: new Date("2026-09-18T11:50:00Z") }),
      ],
      { windowHours: 1, now: NOW, thresholds: THRESHOLDS, liveServerIds: ["cmps01"] },
    );

    expect(out.servers[0].models[0].buckets[0].state).toBe("outage");
  });

  it("applies thresholds before bucketing so degraded exists despite never being stored", () => {
    const out = bucketSamples([s({ observedAt: new Date("2026-09-18T11:10:00Z"), waiting: 9 })], {
      windowHours: 1,
      now: NOW,
      thresholds: THRESHOLDS,
      liveServerIds: ["cmps01"],
    });

    expect(out.servers[0].models[0].buckets[0].state).toBe("degraded");
  });

  it("counts operational and degraded as up in uptimePct", () => {
    const out = bucketSamples(
      [
        s({ observedAt: new Date("2026-09-18T09:10:00Z") }),
        s({ observedAt: new Date("2026-09-18T10:10:00Z"), waiting: 9 }),
        s({
          observedAt: new Date("2026-09-18T11:10:00Z"),
          state: "OUTAGE",
          reachable: false,
          waiting: null,
          cacheUsage: null,
        }),
      ],
      { windowHours: 3, now: NOW, thresholds: THRESHOLDS, liveServerIds: ["cmps01"] },
    );

    // 2 of 3 samples up.
    expect(out.servers[0].models[0].uptimePct).toBeCloseTo(66.7, 1);
  });

  it("widens the bucket to the poll interval when that exceeds an hour", () => {
    const out = bucketSamples(
      [s({ observedAt: new Date("2026-09-18T11:10:00Z"), intervalMinutes: 120 })],
      { windowHours: 4, now: NOW, thresholds: THRESHOLDS, liveServerIds: ["cmps01"] },
    );

    expect(out.bucketMinutes).toBe(120);
    expect(out.servers[0].models[0].buckets).toHaveLength(2);
  });
});
