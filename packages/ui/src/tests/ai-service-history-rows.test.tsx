import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HistoryLegend, HistoryServerSection } from "../ai-service-history-rows";

const server = {
  key: "server-01",
  label: "Server 01",
  waiting: 3,
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
    {
      key: "qwen-2b-01",
      label: "Qwen:2b-01",
      uptimePct: null,
      buckets: [{ t: "2026-09-18T10:00:00.000Z", state: "unknown" as const }],
    },
  ],
};

describe("HistoryServerSection", () => {
  it("renders the server's load line and one row per model", () => {
    render(<HistoryServerSection server={server} windowHours={72} stale={false} />);

    expect(screen.getByText("Server 01")).toBeInTheDocument();
    expect(screen.getByText(/queue 3/)).toBeInTheDocument();
    expect(screen.getByText("Qwen:9b-01")).toBeInTheDocument();
    expect(screen.getByText("Qwen:2b-01")).toBeInTheDocument();
  });

  it("says the load is unmeasured rather than printing a zero queue", () => {
    render(
      <HistoryServerSection
        server={{ ...server, waiting: null, cacheUsage: null }}
        windowHours={72}
        stale={false}
      />,
    );

    expect(screen.getByText(/queue n\/a/i)).toBeInTheDocument();
  });

  it("keeps a no-data bucket visually distinct from an operational one", () => {
    const { container } = render(
      <HistoryServerSection server={server} windowHours={72} stale={false} />,
    );
    const bars = container.querySelectorAll("[data-bucket-state]");

    expect(bars[0].getAttribute("data-bucket-state")).toBe("operational");
    expect(bars[1].getAttribute("data-bucket-state")).toBe("none");
    expect(bars[0].className).not.toBe(bars[1].className);
  });

  it("gives each model one accessible summary rather than one per bar", () => {
    render(<HistoryServerSection server={server} windowHours={72} stale={false} />);

    expect(
      screen.getByLabelText(/Qwen:9b-01: 99\.2% uptime over the last 72 hours, currently/i),
    ).toBeInTheDocument();
  });

  it("refuses to claim a current state when the data is stale", () => {
    render(<HistoryServerSection server={server} windowHours={72} stale />);

    // Every model in the section must carry the disclaimer, not just the first.
    expect(screen.getAllByLabelText(/current state unknown — status data is stale/i)).toHaveLength(
      server.models.length,
    );
    expect(screen.queryByLabelText(/currently operational/i)).not.toBeInTheDocument();
  });

  it("reports an unmeasurable uptime as n/a rather than 0%", () => {
    render(<HistoryServerSection server={server} windowHours={72} stale={false} />);

    expect(screen.getByText("n/a")).toBeInTheDocument();
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
  });

  it("draws taller bars when it is not dense, so the page reads at full width", () => {
    const { container: compact } = render(
      <HistoryServerSection server={server} windowHours={72} stale={false} dense />,
    );
    const { container: roomy } = render(
      <HistoryServerSection server={server} windowHours={72} stale={false} dense={false} />,
    );

    const compactBar = compact.querySelector("[data-bucket-state]")!;
    const roomyBar = roomy.querySelector("[data-bucket-state]")!;
    expect(compactBar.className).not.toBe(roomyBar.className);
  });
});

describe("HistoryLegend", () => {
  it("names every state a bar can paint, including the two greys", () => {
    render(<HistoryLegend />);

    for (const word of ["Operational", "Degraded", "Outage", "Unknown", "No data"]) {
      expect(screen.getByText(word)).toBeInTheDocument();
    }
  });
});
