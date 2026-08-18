import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockConfig } = vi.hoisted(() => ({ mockConfig: { corsOrigins: [] } }));
vi.mock("../../src/config/settings.js", () => ({ config: mockConfig, default: mockConfig }));

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

describe("csrfOriginGuard (Question Maker, #1571)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.corsOrigins = ["https://qm.eduai.ok.ubc.ca"];
  });

  it("never gates safe methods", () => {
    const { next } = run({ method: "GET", origin: "https://evil.example.com" });
    expect(next).toHaveBeenCalledOnce();
  });

  it("allows a state-changing request with no Origin header", () => {
    const { next } = run({ method: "POST", origin: undefined });
    expect(next).toHaveBeenCalledOnce();
  });

  it("allows a state-changing request from an allowlisted Origin", () => {
    const { next } = run({ method: "PUT", origin: "https://qm.eduai.ok.ubc.ca" });
    expect(next).toHaveBeenCalledOnce();
  });

  it("blocks a state-changing request from a cross-origin Origin", () => {
    const { res, next } = run({ method: "POST", origin: "https://evil.example.com" });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("blocks a literal 'null' Origin on a mutation", () => {
    const { res, next } = run({ method: "DELETE", origin: "null" });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("disables the check when the allowlist contains '*'", () => {
    mockConfig.corsOrigins = ["*"];
    const { next } = run({ method: "POST", origin: "https://anything.example.com" });
    expect(next).toHaveBeenCalledOnce();
  });
});
