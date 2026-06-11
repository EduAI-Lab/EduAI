/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { appendAuthSetCookies } from "~/lib/auth/forward-session-cookies";

describe("appendAuthSetCookies", () => {
  it("appends every cookie from getSetCookie()", () => {
    const headers = new Headers();
    const response = new Response(null, {
      headers: {
        "set-cookie": "a=1; Path=/",
      },
    });
    response.headers.getSetCookie = () => [
      "session_token=abc; Path=/; HttpOnly",
      "session_data=xyz; Path=/; HttpOnly",
    ];

    appendAuthSetCookies(response, headers);

    expect(headers.getSetCookie()).toEqual([
      "session_token=abc; Path=/; HttpOnly",
      "session_data=xyz; Path=/; HttpOnly",
    ]);
  });

  it("falls back to a single Set-Cookie header when getSetCookie is missing", () => {
    const headers = new Headers();
    const response = new Response(null, {
      headers: {
        "set-cookie": "session_token=abc; Path=/; HttpOnly",
      },
    });

    appendAuthSetCookies(response, headers);

    expect(headers.get("set-cookie")).toBe("session_token=abc; Path=/; HttpOnly");
  });

  it("does nothing when the auth response has no cookies", () => {
    const headers = new Headers();
    appendAuthSetCookies(new Response(), headers);
    expect(headers.getSetCookie()).toEqual([]);
  });
});
