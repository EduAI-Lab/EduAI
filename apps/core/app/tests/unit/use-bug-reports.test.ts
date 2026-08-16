/**
 * Unit tests for the admin bug-reports list hook.
 *
 * Covers: the initial fetch (page-limit param, row normalization via
 * `normalizeAdminBugReportRow`, `total`), the error branch (both an API error
 * response and a thrown/non-Error rejection), manual `refresh()`,
 * `loadReportDetail`, and `updateReportStatus` (including the UI→Core status
 * enum mapping).
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBugReports } from "~/hooks/api/use-bug-reports";

const rawReport = {
  id: "bug-1",
  description: "Button does nothing",
  bugType: "FEATURE_NOT_WORKING",
  status: "UNHANDLED",
  isAnonymous: false,
  userId: "user-1",
  userName: "Ada Lovelace",
  userEmail: "ada@example.com",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn().mockResolvedValue(jsonResponse({ reports: [rawReport], total: 1 }));
  vi.stubGlobal("fetch", mockFetch);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useBugReports", () => {
  it("fetches with the server-max page limit and normalizes rows", async () => {
    const { result } = renderHook(() => useBugReports());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(String(mockFetch.mock.calls[0][0])).toBe("/api/admin/bug-reports?limit=200");
    expect(result.current.reports).toHaveLength(1);
    expect(result.current.reports[0]).toMatchObject({
      id: "bug-1",
      status: "unhandled",
      reporterName: "Ada Lovelace",
      reporterEmail: "ada@example.com",
    });
    expect(result.current.total).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it("defaults total to null when the server omits it", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ reports: [] }));

    const { result } = renderHook(() => useBugReports());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.total).toBeNull();
    expect(result.current.reports).toEqual([]);
  });

  it("surfaces the server error message and logs it, on a failed fetch", async () => {
    mockFetch.mockResolvedValue(new Response("service unavailable", { status: 503 }));

    const { result } = renderHook(() => useBugReports());

    await waitFor(() => expect(result.current.error).toBe("service unavailable"));
    expect(result.current.isLoading).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it("falls back to a generic message when the thrown value is not an Error", async () => {
    mockFetch.mockRejectedValue("connection reset");

    const { result } = renderHook(() => useBugReports());

    await waitFor(() => expect(result.current.error).toBe("Failed to fetch bug reports"));
  });

  it("is loading true synchronously on mount, then false once resolved", async () => {
    const { result } = renderHook(() => useBugReports());

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("refresh() re-fetches and clears a previous error", async () => {
    mockFetch.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    const { result } = renderHook(() => useBugReports());
    await waitFor(() => expect(result.current.error).toBe("boom"));

    mockFetch.mockResolvedValueOnce(jsonResponse({ reports: [rawReport], total: 1 }));
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.reports).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("loadReportDetail fetches and normalizes a single report", async () => {
    const { result } = renderHook(() => useBugReports());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    mockFetch.mockResolvedValueOnce(jsonResponse(rawReport));

    let detail: unknown;
    await act(async () => {
      detail = await result.current.loadReportDetail("bug-1");
    });

    expect(String(mockFetch.mock.calls[1][0])).toBe("/api/admin/bug-reports/bug-1");
    expect(detail).toMatchObject({ id: "bug-1", status: "unhandled" });
  });

  it("updateReportStatus PATCHes the Core enum form and returns the new status", async () => {
    const { result } = renderHook(() => useBugReports());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    let updateResult: unknown;
    await act(async () => {
      updateResult = await result.current.updateReportStatus("bug-1", "in progress");
    });

    const [url, init] = mockFetch.mock.calls[1];
    expect(String(url)).toBe("/api/admin/bug-reports/bug-1");
    expect((init as RequestInit).method).toBe("PATCH");
    expect((init as RequestInit).body).toBe(JSON.stringify({ status: "IN_PROGRESS" }));
    expect(updateResult).toMatchObject({ status: "in progress" });
  });

  it("updateReportStatus rejects when the PATCH fails", async () => {
    const { result } = renderHook(() => useBugReports());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    mockFetch.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));

    await expect(result.current.updateReportStatus("bug-1", "resolved")).rejects.toThrow(
      "forbidden",
    );
  });
});
