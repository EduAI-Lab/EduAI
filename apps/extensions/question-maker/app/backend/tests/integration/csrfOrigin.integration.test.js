import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../../src/services/authService.js", () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../src/config/settings.js", () => {
  const cfg = {
    coreUrl: "http://core.test",
    corePublicOrigin: "https://core.example.test",
    extensionUrl: "https://qm.example.test",
    corsOrigins: ["https://qm.example.test"],
    eduaiApiKey: "verified-service-key",
    nodeEnv: "test",
    logLevel: "silent",
  };
  return { config: cfg, default: cfg };
});
const { default: app } = await import("../../src/app.js");

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: { id: "u1", role: "INSTRUCTOR" } }),
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("cookie-authenticated CSRF origin guard", () => {
  it("rejects a malicious sibling Origin before auth or route mutation", async () => {
    const res = await request(app)
      .post("/api/eduai/chat")
      .set("Cookie", "session=valid")
      .set("Origin", "https://evil.example.test")
      .send({ messages: [{ role: "user", content: "probe" }], courseCode: "COSC 101" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CSRF_ORIGIN_DENIED");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows a trusted Origin to continue to normal route validation", async () => {
    const res = await request(app)
      .post("/api/eduai/chat")
      .set("Cookie", "session=valid")
      .set("Origin", "https://qm.example.test")
      .send({ courseCode: "COSC 101" });

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/messages/i);
    expect(fetch).toHaveBeenCalled();
  });

  it("rejects cookie mutations with no browser provenance", async () => {
    const res = await request(app)
      .post("/api/eduai/chat")
      .set("Cookie", "session=valid")
      .send({ courseCode: "COSC 101" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CSRF_ORIGIN_DENIED");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts a trusted Referer when Origin is unavailable", async () => {
    const res = await request(app)
      .post("/api/eduai/chat")
      .set("Cookie", "session=valid")
      .set("Referer", "https://qm.example.test/questions")
      .send({ courseCode: "COSC 101" });

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/messages/i);
    expect(fetch).toHaveBeenCalled();
  });

  it("rejects Fetch Metadata cross-site requests even when Origin is omitted", async () => {
    const res = await request(app)
      .post("/api/eduai/chat")
      .set("Cookie", "session=valid")
      .set("Sec-Fetch-Site", "cross-site")
      .send({ messages: [{ role: "user", content: "probe" }], courseCode: "COSC 101" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CSRF_ORIGIN_DENIED");
  });

  it("does not apply the cookie-origin check to server requests without cookies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
      }),
    );

    const res = await request(app)
      .post("/api/eduai/chat")
      .set("Origin", "https://evil.example.test")
      .send({ messages: [{ role: "user", content: "probe" }], courseCode: "COSC 101" });

    expect(res.status).toBe(401);
    expect(fetch).toHaveBeenCalled();
  });

  it("allows an origin-less cookie request with the verified service credential", async () => {
    const res = await request(app)
      .post("/api/eduai/chat")
      .set("Cookie", "session=valid")
      .set("Authorization", "Bearer verified-service-key")
      .send({ courseCode: "COSC 101" });

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/messages/i);
    expect(fetch).toHaveBeenCalled();
  });
});
