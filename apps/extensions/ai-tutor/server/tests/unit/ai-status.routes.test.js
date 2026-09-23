import express from "express";
import request from "supertest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { default: aiStatusRoutes } = await import("../../src/routes/ai-status.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", aiStatusRoutes);
  return app;
}

const app = buildApp();
const UNKNOWN = { state: "unknown", detail: "Status unavailable." };
// The fallback now also reports "we don't know how fresh this is" (checkedAt:
// null, stale: true) rather than silently omitting freshness when Core is
// unreachable — see the ai-status.js UNKNOWN_STATUS comment.
const UNKNOWN_STATUS = { cloud: UNKNOWN, ubc: UNKNOWN, checkedAt: null, stale: true };

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/ai-status", () => {
  it("proxies Core status through on a healthy response", async () => {
    // AI Tutor delegates to Core, so it forwards whatever tiers Core reports —
    // including the #1551 `degraded` state — verbatim.
    const payload = {
      cloud: { state: "operational", detail: "ok" },
      ubc: { state: "degraded", detail: "UBC-hosted inference under heavy load." },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => payload });

    const res = await request(app).get("/api/ai-status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(payload);
  });

  it("passes an AbortSignal timeout to the upstream fetch", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true, json: async () => ({ cloud: UNKNOWN, ubc: UNKNOWN }) });

    await request(app).get("/api/ai-status");

    const [, opts] = fetchMock.mock.calls[0];
    // A bounded probe: an AbortSignal must be attached so a hung Core can't
    // hang the poll open indefinitely.
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it("falls back to UNKNOWN chips when the upstream fetch aborts (timeout)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" }),
    );

    const res = await request(app).get("/api/ai-status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(UNKNOWN_STATUS);
  });

  it("falls back to UNKNOWN chips on a non-ok upstream response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({}),
    });

    const res = await request(app).get("/api/ai-status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(UNKNOWN_STATUS);
  });
});

describe("GET /api/ai-status/history", () => {
  it("proxies Core's history payload through on a healthy response", async () => {
    const payload = {
      windowHours: 72,
      bucketMinutes: 30,
      generatedAt: "2026-09-19T00:00:00.000Z",
      servers: [],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => payload });

    const res = await request(app).get("/api/ai-status/history");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(payload);
  });

  it("requests Core's history endpoint with the 72h window and forwards the cookie", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ windowHours: 72, bucketMinutes: 30, generatedAt: "x", servers: [] }),
    });

    await request(app).get("/api/ai-status/history").set("Cookie", "session=abc");

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/ai-status/history?hours=72");
    expect(opts.headers.cookie).toBe("session=abc");
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns 502 when the upstream fetch is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));

    const res = await request(app).get("/api/ai-status/history");
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "Upstream status history unreachable" });
  });

  it("forwards the upstream status code on a non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });

    const res = await request(app).get("/api/ai-status/history");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "Upstream status history unavailable" });
  });
});
