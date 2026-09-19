import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AIServiceHistoryPanel } from "../ai-service-history-panel";

const payload = {
  windowHours: 72,
  bucketMinutes: 60,
  generatedAt: "2026-09-18T12:00:00.000Z",
  servers: [
    {
      key: "server-01",
      label: "Server 01",
      waiting: 0,
      cacheUsage: 0.42,
      models: [
        {
          key: "qwen-9b-01",
          label: "Qwen:9b-01",
          uptimePct: 99.2,
          buckets: [
            { t: "2026-09-18T10:00:00.000Z", state: "operational" as const },
            { t: "2026-09-18T11:00:00.000Z", state: null },
          ],
        },
      ],
    },
  ],
};

describe("AIServiceHistoryPanel", () => {
  it("groups models under their server and shows uptime as text", () => {
    render(<AIServiceHistoryPanel data={payload} />);

    expect(screen.getByText("Server 01")).toBeInTheDocument();
    expect(screen.getByText("Qwen:9b-01")).toBeInTheDocument();
    expect(screen.getByText("99.2%")).toBeInTheDocument();
  });

  it("gives each model one accessible summary instead of one per bar", () => {
    render(<AIServiceHistoryPanel data={payload} />);

    expect(
      screen.getByLabelText(/Qwen:9b-01: 99\.2% uptime over the last 72 hours/i),
    ).toBeInTheDocument();
  });

  it("renders a no-data bucket distinctly from an operational one", () => {
    const { container } = render(<AIServiceHistoryPanel data={payload} />);
    const bars = container.querySelectorAll("[data-bucket-state]");

    expect(bars[0].getAttribute("data-bucket-state")).toBe("operational");
    expect(bars[1].getAttribute("data-bucket-state")).toBe("none");
  });

  it("shows a stale banner when the data is stale", () => {
    render(<AIServiceHistoryPanel data={payload} stale checkedAt="2026-09-18T11:13:00.000Z" />);
    expect(screen.getByText(/status data is stale/i)).toBeInTheDocument();
  });

  it("shows a cold-start message when there is no history at all", () => {
    render(<AIServiceHistoryPanel data={{ ...payload, servers: [] }} coldStartMinutes={15} />);
    expect(screen.getByText(/first check runs within 15 minutes/i)).toBeInTheDocument();
  });

  it("keeps the last payload visible on a fetch error", () => {
    render(<AIServiceHistoryPanel data={payload} error="Network error" />);
    expect(screen.getByText("Qwen:9b-01")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
