/**
 * Unit tests for useSubmitBugReport — the POST /api/bug-reports hook.
 *
 * Covers the success path (201 with no body), the server-error path (error
 * message read from the JSON body and returned to the caller), the non-JSON
 * error-body fallback, the thrown/rejected fetch fallback message, diagnostics
 * forwarding (only when supplied, #1752), and the isSubmitting transitions.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSubmitBugReport } from "~/hooks/api/use-submit-bug-report";
import type { ParsedJsonBody } from "../helpers/route-fixtures";

function res(init: { ok: boolean; status: number; json?: () => Promise<ParsedJsonBody> }) {
  return {
    ok: init.ok,
    status: init.status,
    json: init.json ?? (() => Promise.resolve({})),
  } as Response;
}

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useSubmitBugReport", () => {
  it("submits the trimmed description and defaults optional fields", async () => {
    mockFetch.mockResolvedValue(res({ ok: true, status: 201 }));

    const { result } = renderHook(() => useSubmitBugReport());

    let outcome: Awaited<ReturnType<typeof result.current.submitBugReport>> | undefined;
    await act(async () => {
      outcome = await result.current.submitBugReport({ description: "  it broke  " });
    });

    expect(outcome).toEqual({ ok: true });
    expect(result.current.error).toBeNull();
    expect(result.current.isSubmitting).toBe(false);
    expect(mockFetch).toHaveBeenCalledWith("/api/bug-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "it broke", bugType: null, isAnonymous: false }),
    });
  });

  it("passes through bugType and isAnonymous when supplied", async () => {
    mockFetch.mockResolvedValue(res({ ok: true, status: 201 }));

    const { result } = renderHook(() => useSubmitBugReport());

    await act(async () => {
      await result.current.submitBugReport({
        description: "crash",
        bugType: "CRASH",
        isAnonymous: true,
      } as never);
    });

    const [, init] = mockFetch.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      description: "crash",
      bugType: "CRASH",
      isAnonymous: true,
    });
  });

  it("returns and surfaces the server error message on failure", async () => {
    mockFetch.mockResolvedValue(
      res({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: "description required" }),
      }),
    );

    const { result } = renderHook(() => useSubmitBugReport());

    let outcome: Awaited<ReturnType<typeof result.current.submitBugReport>> | undefined;
    await act(async () => {
      outcome = await result.current.submitBugReport({ description: "" });
    });

    expect(outcome).toEqual({ ok: false, error: "description required" });
    expect(result.current.error).toBe("description required");
    expect(result.current.isSubmitting).toBe(false);
  });

  it("falls back to a generic message when the error body has no error field", async () => {
    mockFetch.mockResolvedValue(res({ ok: false, status: 500, json: () => Promise.resolve({}) }));

    const { result } = renderHook(() => useSubmitBugReport());

    await act(async () => {
      await result.current.submitBugReport({ description: "x" });
    });

    expect(result.current.error).toBe("Failed to submit bug report");
  });

  it("falls back to a generic message when the error body isn't valid JSON", async () => {
    mockFetch.mockResolvedValue(
      res({ ok: false, status: 500, json: () => Promise.reject(new Error("not json")) }),
    );

    const { result } = renderHook(() => useSubmitBugReport());

    await act(async () => {
      await result.current.submitBugReport({ description: "x" });
    });

    expect(result.current.error).toBe("Failed to submit bug report");
  });

  it("falls back to a generic message when the thrown value is not an Error", async () => {
    mockFetch.mockRejectedValue("socket hangup");

    const { result } = renderHook(() => useSubmitBugReport());

    let outcome: Awaited<ReturnType<typeof result.current.submitBugReport>> | undefined;
    await act(async () => {
      outcome = await result.current.submitBugReport({ description: "x" });
    });

    expect(outcome).toEqual({ ok: false, error: "Failed to submit bug report" });
    expect(result.current.error).toBe("Failed to submit bug report");
  });

  it("sends no diagnostics fields when none are supplied", async () => {
    mockFetch.mockResolvedValue(res({ ok: true, status: 201 }));

    const { result } = renderHook(() => useSubmitBugReport());

    await act(async () => {
      await result.current.submitBugReport({
        description: "Steps to reproduce it",
        bugType: "OTHER",
        consoleLogs: null,
        screenshot: null,
      });
    });

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    for (const key of ["consoleLogs", "networkLogs", "screenshot", "pageUrl", "userAgent"]) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it("forwards diagnostics when supplied", async () => {
    mockFetch.mockResolvedValue(res({ ok: true, status: 201 }));

    const { result } = renderHook(() => useSubmitBugReport());

    await act(async () => {
      await result.current.submitBugReport({
        description: "Steps to reproduce it",
        bugType: "OTHER",
        consoleLogs: "[]",
        networkLogs: "[]",
        screenshot: "data:image/jpeg;base64,a",
        pageUrl: "http://localhost/x",
        userAgent: "ua",
      });
    });

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({
      description: "Steps to reproduce it",
      bugType: "OTHER",
      isAnonymous: false,
      consoleLogs: "[]",
      networkLogs: "[]",
      screenshot: "data:image/jpeg;base64,a",
      pageUrl: "http://localhost/x",
      userAgent: "ua",
    });
  });

  it("sets isSubmitting true while the request is in flight", async () => {
    let resolveFetch: (v: Response) => void;
    mockFetch.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const { result } = renderHook(() => useSubmitBugReport());
    expect(result.current.isSubmitting).toBe(false);

    let submitPromise!: ReturnType<typeof result.current.submitBugReport>;
    act(() => {
      submitPromise = result.current.submitBugReport({ description: "x" });
    });

    await waitFor(() => expect(result.current.isSubmitting).toBe(true));

    await act(async () => {
      resolveFetch(res({ ok: true, status: 201 }));
      await submitPromise;
    });

    expect(result.current.isSubmitting).toBe(false);
  });
});
