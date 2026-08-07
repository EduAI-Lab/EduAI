// @vitest-environment node
// #1213 — auth/logout.tsx loader + action: GET always bounces to login;
// POST clears prefs (best-effort), invalidates the session via better-auth,
// forwards its cookies, and logs LOGOUT even when there was no session.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

vi.mock("~/lib/user-preferences.server", () => ({
  clearUserPreference: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn((p: Promise<unknown>) => p),
  logSecurityEvent: vi.fn().mockResolvedValue(undefined),
}));

import { loader, action } from "~/routes/auth/logout";
import { auth } from "~/lib/auth/server";
import { clearUserPreference } from "~/lib/user-preferences.server";
import { logSecurityEvent } from "~/lib/logging.server";

function makeArgs(method: "GET" | "POST" = "POST") {
  return {
    request: new Request("http://localhost/auth/logout", { method }),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.handler).mockResolvedValue(new Response(null, { status: 200 }));
});

describe("auth/logout loader", () => {
  it("always redirects GET to /auth/login", async () => {
    const res = (await loader(makeArgs("GET"))) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/login");
  });
});

describe("auth/logout action", () => {
  it("clears user preferences and logs LOGOUT for a signed-in user", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT", email: "u1@ubc.ca" },
    } as never);

    const res = (await action(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/login");
    expect(clearUserPreference).toHaveBeenCalledWith("u1");
    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actionCode: "LOGOUT", outcome: "SUCCESS", entityId: "u1" }),
    );
  });

  it("still logs out (without clearing prefs) when there is no session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);

    const res = (await action(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(clearUserPreference).not.toHaveBeenCalled();
    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actionCode: "LOGOUT", entityId: null }),
    );
  });

  it("does not fail the logout when clearing preferences throws", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT", email: "u1@ubc.ca" },
    } as never);
    vi.mocked(clearUserPreference).mockRejectedValue(new Error("db down"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = (await action(makeArgs())) as Response;
    expect(res.status).toBe(302);
    consoleSpy.mockRestore();
  });

  it("forwards Set-Cookie headers from the better-auth sign-out response", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { "Set-Cookie": "better-auth.session=; Max-Age=0" },
      }),
    );
    const res = (await action(makeArgs())) as Response;
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
});
