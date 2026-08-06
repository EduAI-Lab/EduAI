// @vitest-environment node
//
// AUTH-06: `getExpiredPasswordRedirect` in the root loader only runs for the
// HTML document (page navigations), so `/api/*` resource routes never hit
// it and an expired account could keep calling the API forever. This
// exercises the second root middleware entry that closes that gap.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/password-expiry.server", () => ({
  isPasswordExpiredForUser: vi.fn(),
  getExpiredPasswordRedirect: vi.fn(),
}));

import { middleware } from "~/root";
import { auth } from "~/lib/auth/server";
import { isPasswordExpiredForUser } from "~/lib/auth/password-expiry.server";

const passwordExpiryMiddleware = middleware[1] as (
  args: { request: Request },
  next: () => Promise<Response>,
) => Promise<Response>;

function makeArgs(path: string): { request: Request } {
  return { request: new Request(`http://localhost${path}`) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("root middleware — password expiry on /api/* (AUTH-06)", () => {
  it("blocks an /api/* call from a session with an expired password", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    vi.mocked(isPasswordExpiredForUser).mockResolvedValue(true);
    const next = vi.fn();

    const res = await passwordExpiryMiddleware(makeArgs("/api/chat"), next);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(
      expect.objectContaining({ error: "PASSWORD_EXPIRED" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("allows an /api/* call through when the password is not expired", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    vi.mocked(isPasswordExpiredForUser).mockResolvedValue(false);
    const ok = new Response("ok");
    const next = vi.fn().mockResolvedValue(ok);

    const res = await passwordExpiryMiddleware(makeArgs("/api/chat"), next);

    expect(res).toBe(ok);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("exempts /api/auth/* so an expired user can still sign out or change their password", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    vi.mocked(isPasswordExpiredForUser).mockResolvedValue(true);
    const ok = new Response("ok");
    const next = vi.fn().mockResolvedValue(ok);

    const res = await passwordExpiryMiddleware(makeArgs("/api/auth/change-password"), next);

    expect(res).toBe(ok);
    expect(isPasswordExpiredForUser).not.toHaveBeenCalled();
  });

  it("does not enforce it for non-API (page) requests — the loader owns that path", async () => {
    const next = vi.fn().mockResolvedValue(new Response("ok"));

    await passwordExpiryMiddleware(makeArgs("/dashboard"), next);

    expect(auth.api.getSession).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does not block a service-key / x-api-key call with no session cookie", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const ok = new Response("ok");
    const next = vi.fn().mockResolvedValue(ok);

    const res = await passwordExpiryMiddleware(makeArgs("/api/chat"), next);

    expect(res).toBe(ok);
    expect(isPasswordExpiredForUser).not.toHaveBeenCalled();
  });
});
