/**
 * Unit tests for the server-paginated AI model hooks (#1041).
 *
 * The point of the migration is that search and the provider filter are query
 * params rather than array filters — filtering the loaded page would only ever
 * search that page. These tests pin the request shape, the offset reset on a
 * filter change, and that every mutation refreshes from the server rather than
 * patching local state (a stale `total` would desync the pager).
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/api/config", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "~/hooks/api/config";
import type { AIModel } from "~/hooks/api/types";
import { fetchModelsByProvider, useAiModels } from "~/hooks/api/use-ai-models";

const model = {
  id: "model-1",
  modelId: "gpt-test",
  name: "Test Model",
  isActive: true,
  providerId: "prov-1",
} as unknown as AIModel;

function mockPage(data: AIModel[] = [model], total = data.length) {
  vi.mocked(apiFetch).mockResolvedValue({ data, total, page: 1, pageSize: 25 } as never);
}

/** URLs the hook requested, in order. */
function listUrls() {
  return vi
    .mocked(apiFetch)
    .mock.calls.map((c) => c[0] as string)
    .filter((url) => url.startsWith("/api/ai-models?"));
}

describe("useAiModels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiFetch).mockReset();
  });

  it("requests the first page with paging params and exposes the server total", async () => {
    mockPage([model], 137);

    const { result } = renderHook(() => useAiModels());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.models).toEqual([model]);
    // `total` is the platform-wide count, not the loaded page length.
    expect(result.current.total).toBe(137);
    expect(listUrls()[0]).toContain("page=1");
    expect(listUrls()[0]).toContain("pageSize=25");
  });

  it("sends the provider filter as a query param", async () => {
    mockPage();
    const { result } = renderHook(() => useAiModels());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setProviderId("prov-9"));

    await waitFor(() => expect(listUrls().some((u) => u.includes("providerId=prov-9"))).toBe(true));
  });

  it("resets the offset when the provider filter changes, so page 3 of the old filter isn't requested", async () => {
    mockPage();
    const { result } = renderHook(() => useAiModels());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setPagination({ pageIndex: 2, pageSize: 25 }));
    await waitFor(() => expect(result.current.pagination.pageIndex).toBe(2));

    act(() => result.current.setProviderId("prov-9"));

    await waitFor(() => expect(result.current.pagination.pageIndex).toBe(0));
  });

  it("debounces search into the query string", async () => {
    vi.useFakeTimers();
    try {
      mockPage();
      const { result } = renderHook(() => useAiModels());
      await vi.waitFor(() => expect(result.current.isLoading).toBe(false));

      act(() => result.current.setSearch("claude"));
      // Not yet — the debounce window has not elapsed.
      expect(listUrls().some((u) => u.includes("search=claude"))).toBe(false);

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      await vi.waitFor(() =>
        expect(listUrls().some((u) => u.includes("search=claude"))).toBe(true),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("records an error message instead of throwing when the list request fails", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useAiModels());

    await waitFor(() => expect(result.current.error).toBe("boom"));
    expect(result.current.models).toEqual([]);
  });

  it("createModel POSTs then refreshes from the server", async () => {
    mockPage();
    const { result } = renderHook(() => useAiModels());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const before = listUrls().length;

    await act(async () => {
      await result.current.createModel({ modelId: "new" });
    });

    expect(vi.mocked(apiFetch).mock.calls.some(([url, init]) =>
      url === "/api/ai-models" && (init as RequestInit)?.method === "POST",
    )).toBe(true);
    expect(listUrls().length).toBeGreaterThan(before);
  });

  it("updateModel PATCHes then refreshes", async () => {
    mockPage();
    const { result } = renderHook(() => useAiModels());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const before = listUrls().length;

    await act(async () => {
      await result.current.updateModel("model-1", { name: "Renamed" });
    });

    expect(vi.mocked(apiFetch).mock.calls.some(([url, init]) =>
      url === "/api/ai-models/model-1" && (init as RequestInit)?.method === "PATCH",
    )).toBe(true);
    expect(listUrls().length).toBeGreaterThan(before);
  });

  it("deleteModel DELETEs then refreshes", async () => {
    mockPage();
    const { result } = renderHook(() => useAiModels());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const before = listUrls().length;

    await act(async () => {
      await result.current.deleteModel("model-1");
    });

    expect(vi.mocked(apiFetch).mock.calls.some(([url, init]) =>
      url === "/api/ai-models/model-1" && (init as RequestInit)?.method === "DELETE",
    )).toBe(true);
    expect(listUrls().length).toBeGreaterThan(before);
  });

  it("toggleModelActive flips isActive through the update path", async () => {
    mockPage();
    const { result } = renderHook(() => useAiModels());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.toggleModelActive({ ...model, isActive: true });
    });

    const patch = vi
      .mocked(apiFetch)
      .mock.calls.find(([url]) => url === "/api/ai-models/model-1");
    expect(JSON.parse((patch?.[1] as RequestInit).body as string)).toEqual({ isActive: false });
  });
});

describe("fetchModelsByProvider", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("asks for one bounded page scoped to the provider and unwraps the envelope", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      data: [model],
      total: 1,
      page: 1,
      pageSize: 200,
    } as never);

    await expect(fetchModelsByProvider("prov-1")).resolves.toEqual([model]);

    const url = vi.mocked(apiFetch).mock.calls[0][0] as string;
    // Local-model sync dedupes against the provider's full set, so it must not
    // inherit the table's 25-row page.
    expect(url).toContain("providerId=prov-1");
    expect(url).toContain("page=1");
    expect(url).toContain("pageSize=200");
  });
});
