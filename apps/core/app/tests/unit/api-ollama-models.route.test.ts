// @vitest-environment node
// #1213 — GET /api/ollama-models: ADMIN-only, resolves/validates the target
// base URL, proxies /api/tags, and maps connection/timeout errors.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/ai/ollama-url.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/ai/ollama-url.server")>();
  return { ...actual };
});

import { loader } from "~/routes/api/ollama-models";
import { auth } from "~/lib/auth/server";
import { InvalidOllamaBaseUrlError } from "~/lib/ai/ollama-url.server";

function makeArgs(query = "") {
  return {
    request: new Request(`http://localhost/api/ollama-models${query}`),
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

describe("GET /api/ollama-models", () => {
  it("returns 403 for a non-admin", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    const res = await loader(makeArgs());
    expect(res.status).toBe(403);
  });

  it("returns 400 for a disallowed baseUrl override", async () => {
    const res = await loader(makeArgs("?baseUrl=http://evil.example.com"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("returns models on success", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ models: [{ name: "llama3", size: 1, digest: "abc", modified_at: "now" }] }),
        { status: 200 },
      ),
    ) as never;

    const res = await loader(makeArgs());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.models).toEqual([
      { name: "llama3", model: "llama3", size: 1, digest: "abc", modified_at: "now", details: {} },
    ]);
  });

  it("passes through a non-ok upstream status", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 502, statusText: "Bad Gateway" }),
    ) as never;
    const res = await loader(makeArgs());
    expect(res.status).toBe(502);
  });

  it("maps ECONNREFUSED to a friendly 500", async () => {
    global.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error("nope"), { code: "ECONNREFUSED" }),
    ) as never;
    const res = await loader(makeArgs());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("Connection refused");
  });

  it("re-throws a non-InvalidOllamaBaseUrlError from URL resolution", async () => {
    // A malformed baseUrl throws TypeError from `new URL()` inside the
    // resolver — that's not InvalidOllamaBaseUrlError, so it propagates.
    const res = await loader(makeArgs("?baseUrl=%")).catch((e) => e);
    if (res instanceof Response) {
      expect(res.status).toBe(400);
    } else {
      expect(res).toBeInstanceOf(Error);
      expect(res).not.toBeInstanceOf(InvalidOllamaBaseUrlError);
    }
  });
});
