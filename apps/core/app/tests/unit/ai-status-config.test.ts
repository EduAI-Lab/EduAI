// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  cronEvery,
  minutesFromCron,
  pollMinutes,
  retentionDays,
  MAX_WINDOW_HOURS,
} from "~/lib/ai/status/config.server";

describe("cronEvery", () => {
  it("renders sub-hour intervals as a minute step", () => {
    expect(cronEvery(15)).toBe("*/15 * * * *");
    expect(cronEvery(1)).toBe("*/1 * * * *");
    expect(cronEvery(59)).toBe("*/59 * * * *");
  });

  it("renders whole-hour intervals as an hour step", () => {
    expect(cronEvery(60)).toBe("0 */1 * * *");
    expect(cronEvery(120)).toBe("0 */2 * * *");
  });

  it("falls back to 15 minutes for values cron cannot express", () => {
    // 90 is neither < 60 nor a multiple of 60 — "*/90" is an invalid minute field.
    expect(cronEvery(90)).toBe("*/15 * * * *");
    expect(cronEvery(0)).toBe("*/15 * * * *");
    expect(cronEvery(-5)).toBe("*/15 * * * *");
    expect(cronEvery(1440)).toBe("*/15 * * * *");
    expect(cronEvery(Number.NaN)).toBe("*/15 * * * *");
  });
});

describe("pollMinutes", () => {
  it("defaults to 15 when unset or blank", () => {
    expect(pollMinutes({})).toBe(15);
    expect(pollMinutes({ AI_STATUS_POLL_MINUTES: "   " })).toBe(15);
  });

  it("reads a valid integer", () => {
    expect(pollMinutes({ AI_STATUS_POLL_MINUTES: "30" })).toBe(30);
  });

  it("falls back to 15 for non-numeric or non-positive values", () => {
    expect(pollMinutes({ AI_STATUS_POLL_MINUTES: "abc" })).toBe(15);
    expect(pollMinutes({ AI_STATUS_POLL_MINUTES: "0" })).toBe(15);
  });
});

describe("retentionDays", () => {
  it("defaults to 7", () => {
    expect(retentionDays({})).toBe(7);
  });

  it("clamps up so retention always covers the maximum query window", () => {
    // MAX_WINDOW_HOURS is 168h = 7 days; a 1-day retention would grey out the chart.
    expect(retentionDays({ AI_STATUS_SAMPLE_RETENTION_DAYS: "1" })).toBe(MAX_WINDOW_HOURS / 24);
  });

  it("allows a longer retention than the window", () => {
    expect(retentionDays({ AI_STATUS_SAMPLE_RETENTION_DAYS: "30" })).toBe(30);
  });
});

describe("minutesFromCron", () => {
  it("round-trips every cadence cronEvery can emit", () => {
    for (const minutes of [5, 15, 30, 59, 60, 120, 720]) {
      expect(minutesFromCron(cronEvery(minutes))).toBe(minutes);
    }
  });

  it("reads a hand-written hourly or daily schedule", () => {
    expect(minutesFromCron("7 * * * *")).toBe(60);
    expect(minutesFromCron("0 2 * * *")).toBe(1440);
  });

  it("returns null for anything that is not a fixed period", () => {
    // The caller falls back to the env default rather than inventing a number.
    expect(minutesFromCron("0 9,17 * * 1-5")).toBeNull();
    expect(minutesFromCron("*/15 * * * 1")).toBeNull();
    expect(minutesFromCron("*/15 * 1 * *")).toBeNull();
    expect(minutesFromCron("not a cron")).toBeNull();
    expect(minutesFromCron(null)).toBeNull();
    expect(minutesFromCron(undefined)).toBeNull();
    expect(minutesFromCron("")).toBeNull();
  });
});
