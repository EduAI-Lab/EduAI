// @vitest-environment node
// #1213 — POST /api/sessions/validate (extension auth Phase 1): method gate,
// rate limiting, auth gate, and the UNIT_ADMIN authorizedUnits DB hydration.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/rate-limit.server", () => ({
  isRateLimited: vi.fn().mockReturnValue(false),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn((p: Promise<unknown>) => p),
  logSecurityEvent: vi.fn().mockResolvedValue(undefined),
}));

import { action } from "~/routes/api/sessions.validate";
import { auth } from "~/lib/auth/server";
import { isRateLimited } from "~/lib/auth/rate-limit.server";
import prisma from "~/lib/prisma.server";
import { logSecurityEvent } from "~/lib/logging.server";

function makeArgs(method = "POST") {
  return {
    request: new Request("http://localhost/api/sessions/validate", { method }),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isRateLimited).mockReturnValue(false);
});

describe("POST /api/sessions/validate", () => {
  it("rejects non-POST methods with 405", async () => {
    const res = await action(makeArgs("GET"));
    expect(res.status).toBe(405);
  });

  it("returns 429 and logs RATE_LIMIT_EXCEEDED when rate-limited", async () => {
    vi.mocked(isRateLimited).mockReturnValue(true);
    const res = await action(makeArgs());
    expect(res.status).toBe(429);
    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actionCode: "RATE_LIMIT_EXCEEDED", outcome: "DENIED" }),
    );
  });

  it("returns 401 for anonymous callers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await action(makeArgs());
    expect(res.status).toBe(401);
  });

  it("returns the user without a DB lookup for non-UNIT_ADMIN roles", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", email: "u1@ubc.ca", name: "U1", image: null, role: "STUDENT" },
    } as never);
    const res = await action(makeArgs());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      user: { id: "u1", email: "u1@ubc.ca", name: "U1", image: null, role: "STUDENT", authorizedUnits: [] },
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("hydrates authorizedUnits from the DB for a UNIT_ADMIN", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "ua-1", email: "ua@ubc.ca", name: "UA", image: null, role: "UNIT_ADMIN" },
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ authorizedUnits: ["COSC"] } as never);

    const res = await action(makeArgs());
    const body = await res.json();
    expect(body.user.authorizedUnits).toEqual(["COSC"]);
  });

  it("defaults role to STUDENT when the session role is missing", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", email: "u1@ubc.ca", name: "U1", image: null, role: null },
    } as never);
    const res = await action(makeArgs());
    const body = await res.json();
    expect(body.user.role).toBe("STUDENT");
  });
});
