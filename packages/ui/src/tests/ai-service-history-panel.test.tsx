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
    // The attribute alone is a weak proxy: assert the actual rendered class
    // differs too, so a collapsed color palette can't hide behind matching
    // data attributes and silently paint a gap the same as healthy.
    expect(bars[0].className).not.toBe(bars[1].className);
  });

  it("shows a stale banner when the data is stale", () => {
    render(<AIServiceHistoryPanel data={payload} stale checkedAt="2026-09-18T11:13:00.000Z" />);
    expect(screen.getByText(/status data is stale/i)).toBeInTheDocument();
  });

  it("states the chip's own verdict in the header so amber over green rows reads as an explanation", () => {
    render(
      <AIServiceHistoryPanel
        data={payload}
        current={{ state: "degraded", detail: "Fleet under heavy load." }}
      />,
    );

    const header = screen.getByRole("status");
    expect(header).toHaveAttribute("data-current-state", "degraded");
    expect(header).toHaveTextContent(/degraded/i);
    expect(header).toHaveTextContent(/fleet under heavy load/i);
  });

  it("omits the header verdict when the caller cannot supply one", () => {
    render(<AIServiceHistoryPanel data={payload} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not claim a current state in the accessible label when the data is stale", () => {
    render(<AIServiceHistoryPanel data={payload} stale checkedAt="2026-09-18T11:13:00.000Z" />);

    expect(
      screen.getByLabelText(/current state unknown — status data is stale/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/currently operational/i)).not.toBeInTheDocument();
  });

  it("names `unknown` in the legend, since it paints its own grey", () => {
    render(<AIServiceHistoryPanel data={payload} />);
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("paints an unrecognised bucket state instead of leaving an invisible gap", () => {
    const odd = {
      ...payload,
      servers: [
        {
          ...payload.servers[0],
          models: [
            {
              ...payload.servers[0].models[0],
              buckets: [{ t: "2026-09-18T10:00:00.000Z", state: "bogus" as never }],
            },
          ],
        },
      ],
    };
    const { container } = render(<AIServiceHistoryPanel data={odd} />);
    const bar = container.querySelector("[data-bucket-state]");

    expect(bar?.className).toContain("bg-muted-foreground/40");
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
