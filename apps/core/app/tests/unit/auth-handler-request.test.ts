/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { buildAuthSubRequest } from "~/lib/auth/auth-handler-request";

describe("buildAuthSubRequest", () => {
  const incoming = new Request("https://dev.eduai.ok.ubc.ca/auth/login", {
    method: "POST",
    headers: {
      cookie: "__Secure-better-auth.session_token=stale; other=x",
      origin: "https://dev.eduai.ok.ubc.ca",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "dev.eduai.ok.ubc.ca",
    },
  });

  it("does not forward cookies for sign-in (avoids stale session after logout)", () => {
    const sub = buildAuthSubRequest(
      "/api/auth/sign-in/email",
      incoming,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );

    expect(sub.url).toBe("https://dev.eduai.ok.ubc.ca/api/auth/sign-in/email");
    expect(sub.headers.get("cookie")).toBeNull();
    expect(sub.headers.get("origin")).toBe("https://dev.eduai.ok.ubc.ca");
    expect(sub.headers.get("x-forwarded-proto")).toBe("https");
  });

  it("forwards cookies for sign-out so the server can invalidate the session", () => {
    const sub = buildAuthSubRequest(
      "/api/auth/sign-out",
      incoming,
      { method: "POST" },
      { forwardCookies: true },
    );

    expect(sub.headers.get("cookie")).toContain("better-auth.session_token=stale");
    expect(sub.headers.get("x-forwarded-host")).toBe("dev.eduai.ok.ubc.ca");
  });
});
