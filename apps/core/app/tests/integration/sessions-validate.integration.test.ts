import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/rate-limit.server", () => ({
  isRateLimited: vi.fn().mockReturnValue(false),
}));

import { action } from "~/routes/api/sessions.validate";
import { auth } from "~/lib/auth/server";
import { isRateLimited } from "~/lib/auth/rate-limit.server";

const MOCK_USER = {
  id: "user-cuid-abc123",
  email: "test@example.com",
  name: "Test User",
  image: null,
  role: "STUDENT",
  isActive: true,
};

const MOCK_SESSION = {
  session: { id: "session-cuid", userId: MOCK_USER.id, expiresAt: new Date() },
  user: MOCK_USER,
};

function makeArgs(method = "POST", headers?: Record<string, string>) {
  return {
    request: new Request("http://localhost/api/sessions/validate", {
      method,
      headers: new Headers(headers),
    }),
    params: {},
    context: {} as never,
  };
}

describe("POST /api/sessions/validate — contract tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isRateLimited).mockReturnValue(false);
  });

  it("returns 200 with user object when a valid session cookie is present", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(MOCK_SESSION as never);

    const response = await action(makeArgs());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      user: {
        id: MOCK_USER.id,
        email: MOCK_USER.email,
        name: MOCK_USER.name,
        image: MOCK_USER.image,
        role: MOCK_USER.role,
        authorizedUnits: [],
      },
    });
  });

  it("defaults role to STUDENT when role is undefined on the session user", async () => {
    const userWithoutRole = { ...MOCK_USER, role: undefined };
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      ...MOCK_SESSION,
      user: userWithoutRole,
    } as never);

    const response = await action(makeArgs());

    expect(response.status).toBe(200);
    const { user } = await response.json();
    expect(user.role).toBe("STUDENT");
  });

  it("returns 401 when no session cookie is present", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);

    const response = await action(makeArgs());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when the session is expired (getSession returns null)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);

    const response = await action(makeArgs());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 429 when the IP is rate-limited", async () => {
    vi.mocked(isRateLimited).mockReturnValueOnce(true);

    const response = await action(makeArgs("POST", { "x-forwarded-for": "1.2.3.4" }));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Too Many Requests" });
  });

  it("returns 405 for non-POST methods handled by action (e.g. PUT)", async () => {
    const response = await action(makeArgs("PUT"));

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: "Method not allowed" });
  });

  it("reads the client IP from x-forwarded-for and passes it to the rate limiter", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(MOCK_SESSION as never);

    await action(makeArgs("POST", { "x-forwarded-for": "10.0.0.1, 10.0.0.2" }));

    expect(isRateLimited).toHaveBeenCalledWith("10.0.0.1");
  });

  it("falls back to 'unknown' as the IP when x-forwarded-for is absent", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(MOCK_SESSION as never);

    await action(makeArgs());

    expect(isRateLimited).toHaveBeenCalledWith("unknown");
  });
});
