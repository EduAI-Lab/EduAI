/**
 * Unit tests for the server-paginated AI provider hook (#1041).
 *
 * `/api/ai-providers` dropped its nested `models` include, so every caller now
 * reads `_count.models`. A provider row that arrives without `_count` must be
 * normalized rather than crashing the table, and mutations refresh from the
 * server so `total` and the page contents stay in step.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/api/config", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "~/hooks/api/config";
import type { AIProvider } from "~/hooks/api/types";
import { useAiProviders } from "~/hooks/api/use-ai-providers";

const provider = {
  id: "prov-1",
  name: "openai",
  displayName: "OpenAI",
  isActive: true,
  _count: { models: 3 },
} as unknown as AIProvider;

function mockPage(data: AIProvider[] = [provider], total = data.length) {
  vi.mocked(apiFetch).mockResolvedValue({ data, total, page: 1, pageSize: 25 } as never);
}

function listUrls() {
  return vi
    .mocked(apiFetch)
    .mock.calls.map((c) => c[0] as string)
    .filter((url) => url.startsWith("/api/ai-providers?"));
}

describe("useAiProviders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiFetch).mockReset();
  });

  it("requests one page with paging params and exposes the server total", async () => {
    mockPage([provider], 42);

    const { result } = renderHook(() => useAiProviders());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.providers).toHaveLength(1);
    expect(result.current.total).toBe(42);
    expect(listUrls()[0]).toContain("page=1");
    expect(listUrls()[0]).toContain("pageSize=25");
  });

  it("honours a caller-supplied pageSize — provider pickers ask for the max", async () => {
    mockPage();

    const { result } = renderHook(() => useAiProviders({ pageSize: 200 }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(listUrls()[0]).toContain("pageSize=200");
  });

  it("defaults a missing _count to zero models rather than leaving it undefined", async () => {
    mockPage([{ ...provider, _count: undefined } as unknown as AIProvider]);

    const { result } = renderHook(() => useAiProviders());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.providers[0]._count).toEqual({ models: 0 });
  });

  it("requests the new offset when the page changes", async () => {
    mockPage();
    const { result } = renderHook(() => useAiProviders());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setPagination({ pageIndex: 2, pageSize: 25 }));

    await waitFor(() => expect(listUrls().some((u) => u.includes("page=3"))).toBe(true));
  });

  it("records an error message instead of throwing when the request fails", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("providers down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useAiProviders());

    await waitFor(() => expect(result.current.error).toBe("providers down"));
    expect(result.current.providers).toEqual([]);
  });

  it("createProvider POSTs then refreshes", async () => {
    mockPage();
    const { result } = renderHook(() => useAiProviders());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const before = listUrls().length;

    await act(async () => {
      await result.current.createProvider({ name: "anthropic" });
    });

    expect(vi.mocked(apiFetch).mock.calls.some(([url, init]) =>
      url === "/api/ai-providers" && (init as RequestInit)?.method === "POST",
    )).toBe(true);
    expect(listUrls().length).toBeGreaterThan(before);
  });

  it("updateProvider PATCHes then refreshes", async () => {
    mockPage();
    const { result } = renderHook(() => useAiProviders());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const before = listUrls().length;

    await act(async () => {
      await result.current.updateProvider("prov-1", { displayName: "Renamed" });
    });

    expect(vi.mocked(apiFetch).mock.calls.some(([url, init]) =>
      url === "/api/ai-providers/prov-1" && (init as RequestInit)?.method === "PATCH",
    )).toBe(true);
    expect(listUrls().length).toBeGreaterThan(before);
  });

  it("deleteProvider DELETEs then refreshes", async () => {
    mockPage();
    const { result } = renderHook(() => useAiProviders());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const before = listUrls().length;

    await act(async () => {
      await result.current.deleteProvider("prov-1");
    });

    expect(vi.mocked(apiFetch).mock.calls.some(([url, init]) =>
      url === "/api/ai-providers/prov-1" && (init as RequestInit)?.method === "DELETE",
    )).toBe(true);
    expect(listUrls().length).toBeGreaterThan(before);
  });

  it("toggleProviderActive flips isActive through the update path", async () => {
    mockPage();
    const { result } = renderHook(() => useAiProviders());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.toggleProviderActive({ ...provider, isActive: false });
    });

    const patch = vi
      .mocked(apiFetch)
      .mock.calls.find(([url]) => url === "/api/ai-providers/prov-1");
    expect(JSON.parse((patch?.[1] as RequestInit).body as string)).toEqual({ isActive: true });
  });
});
