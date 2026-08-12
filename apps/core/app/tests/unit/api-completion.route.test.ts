// @vitest-environment node
// #1213 — POST /api/completion: method gate, the api-key/session/service-key
// auth chain, invalid JSON, and the streaming vs non-streaming response shape.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const checkRateLimitMock = vi.hoisted(() => vi.fn());

vi.mock("~/lib/auth/rate-limit.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/auth/rate-limit.server")>();
  return { ...actual, checkRateLimit: checkRateLimitMock };
});

vi.mock("~/lib/ai/completion.server", () => ({
  runCompletion: vi.fn(),
}));

vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn().mockResolvedValue({ response: null, session: null }),
  requireServiceKey: vi.fn().mockResolvedValue(null),
}));

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { action } from "~/routes/api/completion";
import { runCompletion } from "~/lib/ai/completion.server";
import { enforceAdminIfApiKey, requireServiceKey } from "~/lib/auth/guards.server";
import { auth } from "~/lib/auth/server";

function makeArgs(body: unknown, method = "POST") {
  return {
    request: new Request("http://localhost/api/completion", {
      method,
      ...(body !== undefined
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    }),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CHAT_RATE_LIMIT", "2");
  vi.stubEnv("CHAT_RATE_LIMIT_WINDOW_MS", "60000");
  checkRateLimitMock.mockResolvedValue({ limited: false, retryAfter: 0 });
  vi.mocked(enforceAdminIfApiKey).mockResolvedValue({ response: null, session: null } as never);
  vi.mocked(requireServiceKey).mockResolvedValue(null);
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "u1", role: "STUDENT" },
  } as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/completion", () => {
  it("rejects non-POST methods with 405", async () => {
    const res = await action(makeArgs(undefined, "GET"));
    expect(res.status).toBe(405);
  });

  it("returns the api-key guard's response when present", async () => {
    vi.mocked(enforceAdminIfApiKey).mockResolvedValue({
      response: new Response(null, { status: 403 }),
      session: null,
    } as never);
    const res = await action(makeArgs({}));
    expect(res.status).toBe(403);
    expect(checkRateLimitMock).not.toHaveBeenCalled();
  });

  it("falls through to requireServiceKey when no session and no api-key session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    vi.mocked(requireServiceKey).mockResolvedValue(new Response(null, { status: 401 }) as never);
    const res = await action(makeArgs({}));
    expect(res.status).toBe(401);
    expect(checkRateLimitMock).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await action({
      request: new Request("http://localhost/api/completion", { method: "POST", body: "not json" }),
      params: {},
      context: {} as never,
    } as never);
    expect(res.status).toBe(400);
    expect(checkRateLimitMock).not.toHaveBeenCalled();
  });

  it("uses the authenticated session user as the rate-limit identity", async () => {
    vi.mocked(runCompletion).mockResolvedValue({
      ok: true,
      streaming: false,
      body: { text: "hi" },
      fleetServerId: null,
    } as never);

    await action(makeArgs({ model: "gpt", messages: [] }));

    expect(checkRateLimitMock).toHaveBeenCalledWith("completion:u1", 2, 60_000);
  });

  it("uses the admin API-key session user as the rate-limit identity", async () => {
    vi.mocked(enforceAdminIfApiKey).mockResolvedValue({
      response: null,
      session: { user: { id: "admin-key-owner", role: "ADMIN" } },
    } as never);
    vi.mocked(runCompletion).mockResolvedValue({
      ok: true,
      streaming: false,
      body: { text: "hi" },
      fleetServerId: null,
    } as never);

    await action(makeArgs({ model: "gpt", messages: [] }));

    expect(checkRateLimitMock).toHaveBeenCalledWith(
      "completion:admin-key-owner",
      2,
      60_000,
    );
    expect(auth.api.getSession).not.toHaveBeenCalled();
  });

  it("uses a stable non-secret identity for service-key-only callers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    vi.mocked(requireServiceKey).mockResolvedValue(null);
    vi.mocked(runCompletion).mockResolvedValue({
      ok: true,
      streaming: false,
      body: { text: "hi" },
      fleetServerId: null,
    } as never);

    await action(makeArgs({ model: "gpt", messages: [] }));

    expect(checkRateLimitMock).toHaveBeenCalledWith("completion:service", 2, 60_000);
  });

  it("returns the stable 429 contract before runCompletion", async () => {
    checkRateLimitMock.mockResolvedValue({ limited: true, retryAfter: 11 });

    const res = await action(makeArgs({ model: "gpt", messages: [] }));

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "RATE_LIMITED", retryAfter: 11 });
    expect(res.headers.get("Retry-After")).toBe("11");
    expect(runCompletion).not.toHaveBeenCalled();
  });

  it("maps a runCompletion failure to its status", async () => {
    vi.mocked(runCompletion).mockResolvedValue({ ok: false, error: "MODEL_NOT_FOUND", status: 422 } as never);
    const res = await action(makeArgs({ model: "bogus", messages: [] }));
    expect(res.status).toBe(422);
  });

  it("returns 200 JSON for a non-streaming success", async () => {
    vi.mocked(runCompletion).mockResolvedValue({
      ok: true,
      streaming: false,
      body: { text: "hi" },
      fleetServerId: null,
    } as never);
    const res = await action(makeArgs({ model: "gpt", messages: [] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ text: "hi" });
  });

  it("returns a streaming Response for a streaming success", async () => {
    const streamResponse = new Response("stream", { status: 200 });
    vi.mocked(runCompletion).mockResolvedValue({
      ok: true,
      streaming: true,
      fleetServerId: "fleet-1",
      result: { toDataStreamResponse: vi.fn(() => streamResponse) },
    } as never);
    const res = await action(makeArgs({ model: "gpt", messages: [], streaming: true }));
    expect(res).toBe(streamResponse);
  });
});
