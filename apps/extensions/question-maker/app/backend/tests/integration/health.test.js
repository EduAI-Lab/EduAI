/**
 * HTTP smoke tests for routes that do not require a database.
 */
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../../src/app.js";
import { prisma } from "../../src/config/database.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /healthz", () => {
  it("returns 200 without probing the database", async () => {
    const databaseProbe = vi
      .spyOn(prisma, "$queryRaw")
      .mockRejectedValueOnce(new Error("database unavailable"));

    const res = await request(app).get("/healthz");

    expect(res.status).toBe(200);
    expect(res.text).toBe("ok");
    expect(databaseProbe).not.toHaveBeenCalled();
  });
});

describe("GET /readyz", () => {
  it("returns 200 only when the database probe succeeds", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ ready: 1 }]);

    const res = await request(app).get("/readyz");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ready" });
  });

  it("returns 503 without leaking database errors when the probe fails", async () => {
    vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(
      new Error("connection refused at postgresql://user:secret@private-db/question-maker"),
    );

    const res = await request(app).get("/readyz");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "unavailable" });
    expect(res.text).not.toContain("secret");
    expect(res.text).not.toContain("private-db");
  });
});

describe("GET /", () => {
  it("returns API status JSON", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      message: "EduQuery.ai API is running",
      version: "1.0.0",
    });
  });
});

describe("unknown route", () => {
  it("returns 404 JSON", async () => {
    const res = await request(app).get("/api/this-route-does-not-exist-xyz");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false });
    expect(String(res.body.error)).toMatch(/not found/i);
  });
});
