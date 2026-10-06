// @vitest-environment node
// #1728 — the reset-code request throttle now runs in Better Auth's `before`
// hook so a direct POST to /api/auth/email-otp/request-password-reset pays it
// too, not just the forgot-password form.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth/rate-limit.server", () => ({
  checkRateLimit: vi.fn(),
  parseEnvInt: (value: string | undefined, fallback: number) =>
    value === undefined || value.trim() === "" ? fallback : Number(value),
}));

import { chargePasswordResetRequest } from "~/lib/auth/password-reset-throttle.server";
import { checkRateLimit } from "~/lib/auth/rate-limit.server";

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/auth/email-otp/request-password-reset", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false, retryAfter: 0 });
});

describe("chargePasswordResetRequest", () => {
  it("charges the client IP, then the target mailbox", async () => {
    const result = await chargePasswordResetRequest(
      request({ "x-forwarded-for": "10.0.0.1, 203.0.113.7" }),
      "student@ubc.ca",
    );

    expect(result).toEqual({ limited: false });
    // The rightmost x-forwarded-for entry is the one our own proxy writes.
    expect(vi.mocked(checkRateLimit).mock.calls.map((call) => call[0])).toEqual([
      "password-reset-request:ip:203.0.113.7",
      "password-reset-request:email:student@ubc.ca",
    ]);
  });

  it("stops at the IP limit without charging the mailbox", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ limited: true, retryAfter: 42 });

    await expect(chargePasswordResetRequest(request(), "student@ubc.ca")).resolves.toEqual({
      limited: true,
      retryAfter: 42,
    });
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
  });

  it("stops at the per-mailbox limit so one address cannot be mail-bombed", async () => {
    vi.mocked(checkRateLimit)
      .mockResolvedValueOnce({ limited: false, retryAfter: 0 })
      .mockResolvedValueOnce({ limited: true, retryAfter: 300 });

    await expect(chargePasswordResetRequest(request(), "student@ubc.ca")).resolves.toEqual({
      limited: true,
      retryAfter: 300,
    });
  });

  it("charges one mailbox bucket however the address is capitalised", async () => {
    await chargePasswordResetRequest(request(), " Student@UBC.ca ");
    await chargePasswordResetRequest(request(), "student@ubc.ca");

    const emailKeys = vi
      .mocked(checkRateLimit)
      .mock.calls.map((call) => call[0])
      .filter((key) => key.startsWith("password-reset-request:email:"));
    expect(emailKeys).toEqual([
      "password-reset-request:email:student@ubc.ca",
      "password-reset-request:email:student@ubc.ca",
    ]);
  });

  it("still charges the IP when the body carries no usable address", async () => {
    await chargePasswordResetRequest(request(), undefined);

    expect(vi.mocked(checkRateLimit).mock.calls.map((call) => call[0])).toEqual([
      "password-reset-request:ip:unknown",
    ]);
  });
});

describe("the throttle is enforced on the Better Auth handler itself", () => {
  it("answers a direct POST to the endpoint with 429 once a bucket is spent", async () => {
    // Reviewer's bypass: `/api/auth/*` forwards straight to `auth.handler`, so
    // a limit that lived only in the forgot-password action never saw this.
    const { auth } = await import("~/lib/auth/server");
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ limited: true, retryAfter: 77 });

    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/email-otp/request-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ email: "victim@ubc.ca" }),
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("77");
  });
});
