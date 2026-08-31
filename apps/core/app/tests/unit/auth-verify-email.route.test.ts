// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

import { action, loader } from "~/routes/auth/verify-email";
import { auth } from "~/lib/auth/server";

function routeArgs(method: "GET" | "POST" = "GET", email = "student@ubc.ca") {
  const headers = new Headers({ cookie: "better-auth.session_token=session-1" });
  const init: RequestInit = { method, headers };
  if (method === "POST") {
    headers.set("Content-Type", "application/x-www-form-urlencoded");
    init.body = new URLSearchParams({ email }).toString();
  }
  return {
    request: new Request("http://localhost/auth/verify-email", init),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth/verify-email loader", () => {
  it("renders for a user without a session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);

    await expect(loader(routeArgs())).resolves.toBeNull();
  });

  it("continues a verified user to Canvas onboarding", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { email: "student@ubc.ca", emailVerified: true },
    } as never);

    const result = (await loader(routeArgs())) as Response;

    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/onboarding/student-id");
  });

  it("renders without exposing a stale unverified session email", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { email: "student@ubc.ca", emailVerified: false },
    } as never);

    await expect(loader(routeArgs())).resolves.toBeNull();
  });
});

describe("auth/verify-email action", () => {
  it("resends anonymously through Better Auth without forwarding a stale cookie", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(JSON.stringify({ status: true }), { status: 200 }),
    );

    await expect(action(routeArgs("POST"))).resolves.toEqual({ sent: true });

    const resendRequest = vi.mocked(auth.handler).mock.calls[0][0] as Request;
    expect(resendRequest.url).toBe("http://localhost/api/auth/send-verification-email");
    expect(resendRequest.headers.get("cookie")).toBeNull();
    expect(await resendRequest.json()).toEqual({
      email: "student@ubc.ca",
      callbackURL: "/onboarding/student-id",
    });
  });

  it("keeps Better Auth rejection non-enumerating", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    vi.mocked(auth.handler).mockResolvedValue(new Response(null, { status: 429 }));

    await expect(action(routeArgs("POST"))).resolves.toEqual({ sent: true });
  });

  it("rejects a non-UBC resend target before Better Auth", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);

    await expect(action(routeArgs("POST", "attacker@example.com"))).resolves.toEqual({
      fieldError: "Email must be a UBC address (e.g. you@student.ubc.ca or you@ubc.ca)",
    });
    expect(auth.handler).not.toHaveBeenCalled();
  });
});
