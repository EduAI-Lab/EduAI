// @vitest-environment node
// #1213 — /api/auth/$ is the public better-auth boundary: it must strip the
// internal invite-signup header from any inbound request before delegating
// to auth.handler, so a browser can't forge the invitation exemption.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { handler: vi.fn() },
}));

import { loader, action } from "~/routes/api/auth.$";
import { auth } from "~/lib/auth/server";
import { INTERNAL_INVITE_SIGNUP_HEADER } from "~/lib/auth/auth-handler-request";

function makeArgs(method: "GET" | "POST") {
  return {
    request: new Request("http://localhost/api/auth/session", {
      method,
      headers: { [INTERNAL_INVITE_SIGNUP_HEADER]: "1" },
    }),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.handler).mockResolvedValue(new Response(null, { status: 200 }));
});

describe("/api/auth/$ catch-all", () => {
  it("loader strips the internal invite-signup header before delegating", async () => {
    await loader(makeArgs("GET"));
    const forwarded = vi.mocked(auth.handler).mock.calls[0][0] as Request;
    expect(forwarded.headers.has(INTERNAL_INVITE_SIGNUP_HEADER)).toBe(false);
  });

  it("action strips the internal invite-signup header before delegating", async () => {
    await action(makeArgs("POST"));
    const forwarded = vi.mocked(auth.handler).mock.calls[0][0] as Request;
    expect(forwarded.headers.has(INTERNAL_INVITE_SIGNUP_HEADER)).toBe(false);
  });
});
