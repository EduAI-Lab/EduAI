// @vitest-environment node
// #1213 — GET /api/vllm-models: ADMIN-only, proxies the vLLM /models
// endpoint, and maps connection/SSL/timeout failures to friendly hints.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { loader } from "~/routes/api/vllm-models";
import { auth } from "~/lib/auth/server";

function makeArgs() {
  return {
    request: new Request("http://localhost/api/vllm-models"),
    params: {},
    context: {} as never,
  } as never;
}

const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "admin-1", role: "ADMIN" },
  } as never);
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

describe("GET /api/vllm-models", () => {
  it("returns 403 for a non-admin", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    const res = await loader(makeArgs());
    expect(res.status).toBe(403);
  });

  it("returns 403 for anonymous callers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await loader(makeArgs());
    expect(res.status).toBe(403);
  });

  it("maps the proxy's model list on success", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: "llama-3", owned_by: "vllm", created: 1 }] }),
        { status: 200 },
      ),
    ) as never;

    const res = await loader(makeArgs());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.models).toEqual([{ id: "llama-3", owned_by: "vllm", created: 1 }]);
  });

  it("passes through a non-ok upstream status", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 502, statusText: "Bad Gateway" }),
    ) as never;

    const res = await loader(makeArgs());
    expect(res.status).toBe(502);
  });

  it("maps ECONNREFUSED to a configuration hint with a 500", async () => {
    global.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    ) as never;

    const res = await loader(makeArgs());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("VLLM_BASE_URL");
  });

  it("maps an AbortError (timeout) to a friendly message", async () => {
    global.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    ) as never;

    const res = await loader(makeArgs());
    const body = await res.json();
    expect(body.error).toContain("timeout");
  });
});
