// @vitest-environment node
// #1728 — the request half of password reset by emailed code. The two things
// this route has to get right are that it says exactly the same thing about
// every address, and that it cannot be used to fire mail at one.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { handler: vi.fn() },
}));

import { action } from "~/routes/auth/forgot-password";
import { auth } from "~/lib/auth/server";

function routeArgs(email: string, headers: Record<string, string> = {}) {
  const request = new Request("http://localhost/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams({ email }).toString(),
  });
  return { request, params: {}, context: {} as never } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.handler).mockResolvedValue(
    new Response(JSON.stringify({ success: true }), { status: 200 }),
  );
});

describe("auth/forgot-password action", () => {
  it("asks Better Auth for a reset code, without forwarding a session cookie", async () => {
    const result = (await action(routeArgs("Student@ubc.ca"))) as Response;

    const sent = vi.mocked(auth.handler).mock.calls[0][0] as Request;
    expect(sent.url).toBe("http://localhost/api/auth/email-otp/request-password-reset");
    expect(sent.headers.get("cookie")).toBeNull();
    expect(await sent.json()).toEqual({ email: "student@ubc.ca" });
    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/auth/reset-password?email=student%40ubc.ca");
  });

  it("answers an unknown address exactly as it answers a known one", async () => {
    // Better Auth returns the same 200 either way; the point of this test is
    // that the route adds nothing that could tell the two apart.
    const known = (await action(routeArgs("known@ubc.ca"))) as Response;
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    const unknown = (await action(routeArgs("nobody@ubc.ca"))) as Response;

    expect(unknown.status).toBe(known.status);
    expect(await unknown.text()).toBe(await known.text());
    expect(unknown.headers.get("Location")).toBe("/auth/reset-password?email=nobody%40ubc.ca");
  });

  it("keeps a Better Auth failure indistinguishable from a success", async () => {
    vi.mocked(auth.handler).mockRejectedValue(new Error("smtp down"));

    const result = (await action(routeArgs("student@ubc.ca"))) as Response;

    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/auth/reset-password?email=student%40ubc.ca");
  });

  it("rejects a malformed address before anything is sent", async () => {
    await expect(action(routeArgs("not-an-email"))).resolves.toEqual({
      fieldError: "Please enter a valid email address",
    });
    expect(auth.handler).not.toHaveBeenCalled();
  });

  it("rejects an oversized address rather than keying a limiter on it", async () => {
    const huge = `${"a".repeat(400)}@ubc.ca`;

    await expect(action(routeArgs(huge))).resolves.toEqual({
      fieldError: "Email address is too long",
    });
    expect(auth.handler).not.toHaveBeenCalled();
  });

  it("shows the retry hint when the endpoint's throttle answers 429", async () => {
    // The throttle itself lives in Better Auth's `before` hook (see
    // password-reset-throttle.test.ts); the action only relays its verdict.
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(null, { status: 429, headers: { "Retry-After": "42" } }),
    );

    await expect(action(routeArgs("student@ubc.ca"))).resolves.toEqual({ retryAfter: 42 });
  });

  it("falls back to a minute when a 429 carries no usable Retry-After", async () => {
    vi.mocked(auth.handler).mockResolvedValue(new Response(null, { status: 429 }));

    await expect(action(routeArgs("student@ubc.ca"))).resolves.toEqual({ retryAfter: 60 });
  });
});
