import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();

vi.mock("../../src/config/database.js", () => ({
  prisma: new Proxy(
    { $queryRaw: (...args) => queryRaw(...args) },
    { get: (target, property) => target[property] ?? vi.fn() },
  ),
}));

const { createApp } = await import("../../src/app.js");

describe("GET /api/health error privacy", () => {
  it("does not return database errors to an unauthenticated caller", async () => {
    const canary = "postgresql://user:secret@internal-db/private";
    queryRaw.mockRejectedValueOnce(new Error(canary));
    const app = await createApp();

    const response = await request(app).get("/api/health");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ ok: false, error: "Database unavailable" });
    expect(JSON.stringify(response.body)).not.toContain(canary);
  });
});
