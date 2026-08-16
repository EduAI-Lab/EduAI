/**
 * Unit tests for the shared `apiFetch` wrapper (app/hooks/api/config.ts).
 *
 * Covers the branches every hook relies on: default Content-Type injection,
 * respecting a caller-supplied Content-Type, the error-parsing paths (JSON
 * body with an `error` field, JSON body without one, and non-JSON text), the
 * 204-no-content short-circuit, and the non-JSON content-type short-circuit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch, ApiError, STUB_ONLY } from "~/hooks/api/config";

function res(init: {
  ok: boolean;
  status: number;
  headers?: Record<string, string>;
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
}): Response {
  const headers = new Headers(init.headers ?? {});
  return {
    ok: init.ok,
    status: init.status,
    headers,
    text: init.text ?? (() => Promise.resolve("")),
    json: init.json ?? (() => Promise.resolve({})),
  } as unknown as Response;
}

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("apiFetch", () => {
  it("sets Content-Type: application/json when a body is present and none was supplied", async () => {
    mockFetch.mockResolvedValue(
      res({
        ok: true,
        status: 200,
        headers: { "Content-Type": "application/json" },
        json: () => Promise.resolve({ ok: true }),
      }),
    );

    await apiFetch("/api/thing", { method: "POST", body: JSON.stringify({ a: 1 }) });

    const [, init] = mockFetch.mock.calls[0];
    const sentHeaders = init.headers as Headers;
    expect(sentHeaders.get("Content-Type")).toBe("application/json");
  });

  it("does not override a caller-supplied Content-Type header", async () => {
    mockFetch.mockResolvedValue(
      res({
        ok: true,
        status: 200,
        headers: { "Content-Type": "application/json" },
        json: () => Promise.resolve({}),
      }),
    );

    await apiFetch("/api/thing", {
      method: "POST",
      body: "raw",
      headers: { "Content-Type": "text/plain" },
    });

    const [, init] = mockFetch.mock.calls[0];
    const sentHeaders = init.headers as Headers;
    expect(sentHeaders.get("Content-Type")).toBe("text/plain");
  });

  it("throws an ApiError using the JSON body's error field when the response is not ok", async () => {
    mockFetch.mockResolvedValue(
      res({
        ok: false,
        status: 422,
        text: () => Promise.resolve(JSON.stringify({ error: "duplicate code" })),
      }),
    );

    await expect(apiFetch("/api/thing")).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
      message: "duplicate code",
    });
  });

  it("falls back to the raw text when the JSON body has no error field", async () => {
    mockFetch.mockResolvedValue(
      res({
        ok: false,
        status: 500,
        text: () => Promise.resolve(JSON.stringify({ somethingElse: true })),
      }),
    );

    await expect(apiFetch("/api/thing")).rejects.toThrow(
      JSON.stringify({ somethingElse: true }),
    );
  });

  it("falls back to a generic message when the error body is empty non-JSON text", async () => {
    mockFetch.mockResolvedValue(
      res({
        ok: false,
        status: 500,
        text: () => Promise.resolve(""),
      }),
    );

    await expect(apiFetch("/api/thing")).rejects.toThrow("Request failed");
  });

  it("uses the non-JSON text verbatim when it is not empty", async () => {
    mockFetch.mockResolvedValue(
      res({
        ok: false,
        status: 502,
        text: () => Promise.resolve("Bad Gateway"),
      }),
    );

    await expect(apiFetch("/api/thing")).rejects.toThrow("Bad Gateway");
  });

  it("returns undefined for a 204 No Content response", async () => {
    mockFetch.mockResolvedValue(res({ ok: true, status: 204 }));

    const result = await apiFetch("/api/thing", { method: "DELETE" });
    expect(result).toBeUndefined();
  });

  it("returns undefined when the content-type is not JSON", async () => {
    mockFetch.mockResolvedValue(
      res({ ok: true, status: 200, headers: { "Content-Type": "text/plain" } }),
    );

    const result = await apiFetch("/api/thing");
    expect(result).toBeUndefined();
  });

  it("parses and returns the JSON body when content-type is application/json", async () => {
    mockFetch.mockResolvedValue(
      res({
        ok: true,
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        json: () => Promise.resolve({ id: "abc" }),
      }),
    );

    const result = await apiFetch("/api/thing");
    expect(result).toEqual({ id: "abc" });
  });
});

describe("ApiError", () => {
  it("carries status and message and is an instance of Error", () => {
    const err = new ApiError(404, "not found");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ApiError");
    expect(err.status).toBe(404);
    expect(err.message).toBe("not found");
  });
});

describe("STUB_ONLY", () => {
  it("flags features with no Core API yet", () => {
    expect(STUB_ONLY.bugReports).toBe(false);
    expect(STUB_ONLY.deleteChat).toBe(false);
  });
});
