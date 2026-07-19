import { describe, expect, it } from "vitest";
import {
  integratePowerSamplesMw,
  raplDeltaJoules,
} from "../../../../../tools/energy-meter/rapl-util.mjs";

describe("raplDeltaJoules", () => {
  it("returns simple positive delta in joules", () => {
    const start = [{ zone: "intel-rapl:0", uj: 1_000_000, maxUj: 1_000_000_000 }];
    const end = [{ zone: "intel-rapl:0", uj: 3_000_000, maxUj: 1_000_000_000 }];
    expect(raplDeltaJoules(start, end)).toBe(2);
  });

  it("handles counter wrap using max_energy_range_uj", () => {
    const maxUj = 1000;
    const start = [{ zone: "intel-rapl:0", uj: 900, maxUj }];
    const end = [{ zone: "intel-rapl:0", uj: 50, maxUj }];
    // (50 - 900) + 1000 = 150 uj = 0.00015 J
    expect(raplDeltaJoules(start, end)).toBeCloseTo(150 / 1_000_000, 12);
  });

  it("sums multiple packages independently through wrap", () => {
    const start = [
      { zone: "intel-rapl:0", uj: 900, maxUj: 1000 },
      { zone: "intel-rapl:2", uj: 100, maxUj: 1000 },
    ];
    const end = [
      { zone: "intel-rapl:0", uj: 50, maxUj: 1000 },
      { zone: "intel-rapl:2", uj: 250, maxUj: 1000 },
    ];
    // pkg0: 150 uj, pkg2: 150 uj → 300 uj
    expect(raplDeltaJoules(start, end)).toBeCloseTo(300 / 1_000_000, 12);
  });

  it("returns null when either side is empty", () => {
    expect(raplDeltaJoules([], [{ zone: "intel-rapl:0", uj: 1, maxUj: 10 }])).toBeNull();
    expect(raplDeltaJoules([{ zone: "intel-rapl:0", uj: 1, maxUj: 10 }], [])).toBeNull();
  });
});

describe("integratePowerSamplesMw", () => {
  it("uses actual sample timestamps instead of fixed dt", () => {
    const samples = [
      { t: 0, mw: 1000 },
      { t: 2000, mw: 1000 },
    ];
    // 1 W average over 2 s = 2 J (fixed 1s dt would give 1 J)
    expect(integratePowerSamplesMw(samples, 1)).toBe(2);
  });
});
