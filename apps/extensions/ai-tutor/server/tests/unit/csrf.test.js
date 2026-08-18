import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/config/cors.js", () => ({
  isAllowedOrigin: (origin) => origin === "https://ai-tutor.eduai.ok.ubc.ca",
}));

const { csrfOriginGuard } = await import("../../src/middleware/csrf.js");

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function run({ method = "POST", origin } = {}) {
  const req = { method, get: (h) => (h.toLowerCase() === "origin" ? origin : undefined) };
  const res = mockRes();
  const next = vi.fn();
  csrfOriginGuard(req, res, next);
  return { res, next };
}

describe("csrfOriginGuard (AI Tutor, #1571)", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["GET", "HEAD", "OPTIONS"])("never gates safe method %s", (method) => {
    const { res, next } = run({ method, origin: "https://evil.example.com" });
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it("allows a state-changing request with no Origin header (non-browser caller)", () => {
    const { next } = run({ method: "POST", origin: undefined });
    expect(next).toHaveBeenCalledOnce();
  });

  it("allows a state-changing request from an allowlisted Origin", () => {
    const { next } = run({ method: "POST", origin: "https://ai-tutor.eduai.ok.ubc.ca" });
    expect(next).toHaveBeenCalledOnce();
  });

  it("blocks a state-changing request from a cross-origin Origin", () => {
    const { res, next } = run({ method: "POST", origin: "https://evil.example.com" });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/cross-origin/i) });
  });
});
