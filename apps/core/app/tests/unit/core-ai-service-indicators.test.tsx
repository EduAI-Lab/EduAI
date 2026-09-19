import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AIServiceIndicators } from "~/components/ai/ai-service-indicators";

const historyPayload = {
  windowHours: 72,
  bucketMinutes: 60,
  generatedAt: "2026-09-18T12:00:00.000Z",
  servers: [
    {
      key: "server-01",
      label: "Server 01",
      waiting: 0,
      cacheUsage: 0.4,
      models: [
        {
          key: "qwen-9b-01",
          label: "Qwen:9b-01",
          uptimePct: 100,
          buckets: [{ t: "2026-09-18T11:00:00.000Z", state: "operational" as const }],
        },
      ],
    },
  ],
};

describe("Core AIServiceIndicators", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          String(url).includes("/history")
            ? historyPayload
            : {
                cloud: { state: "operational" },
                ubc: { state: "operational" },
                checkedAt: "2026-09-18T11:59:00.000Z",
                stale: false,
              },
      })),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("does not fetch history until the popover is opened", async () => {
    render(<AIServiceIndicators />);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const calls = (fetch as unknown as { mock: { calls: string[][] } }).mock.calls;
    expect(calls.some(([url]) => String(url).includes("/history"))).toBe(false);
  });

  it("loads and renders history when the UBC chip is clicked", async () => {
    render(<AIServiceIndicators />);

    fireEvent.click(await screen.findByRole("button", { name: /UBC-hosted AI/i }));

    expect(await screen.findByText("Server 01")).toBeInTheDocument();
    expect(screen.getByText("Qwen:9b-01")).toBeInTheDocument();
  });
});
