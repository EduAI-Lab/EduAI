import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AiStatusPageView } from "~/components/ai/ai-status-page-view";

const payload = {
  windowHours: 72,
  bucketMinutes: 60,
  generatedAt: "2026-09-19T12:00:00.000Z",
  servers: [
    {
      key: "server-01",
      label: "Server 01",
      waiting: 2,
      cacheUsage: 0.31,
      models: [
        {
          key: "qwen-9b-01",
          label: "Qwen:9b-01",
          uptimePct: 99.2,
          buckets: [
            { t: "2026-09-19T10:00:00.000Z", state: "operational" as const },
            { t: "2026-09-19T11:00:00.000Z", state: null },
          ],
        },
      ],
    },
    {
      key: "server-02",
      label: "Server 02",
      waiting: null,
      cacheUsage: null,
      models: [
        {
          key: "qwen-2b-02",
          label: "Qwen:2b-02",
          uptimePct: 100,
          buckets: [{ t: "2026-09-19T11:00:00.000Z", state: "operational" as const }],
        },
      ],
    },
  ],
};

const props = {
  payload,
  ubc: { state: "operational" as const },
  cloud: { state: "operational" as const },
  checkedAt: "2026-09-19T11:58:00.000Z",
  stale: false,
};

describe("AiStatusPageView", () => {
  it("leads with the fleet-wide verdict the chip is showing", () => {
    render(
      <AiStatusPageView
        {...props}
        ubc={{ state: "degraded", detail: "Fleet under heavy load." }}
      />,
    );

    const banner = screen.getByRole("status");
    expect(banner).toHaveAttribute("data-current-state", "degraded");
    expect(banner).toHaveTextContent(/degraded/i);
    expect(banner).toHaveTextContent(/fleet under heavy load/i);
  });

  it("reports the cloud verdict without implying it has history", () => {
    render(<AiStatusPageView {...props} cloud={{ state: "outage", detail: "No key saved." }} />);

    const cloud = screen.getByTestId("cloud-status");
    expect(cloud).toHaveTextContent(/managed cloud ai/i);
    expect(cloud).toHaveTextContent(/outage/i);
    expect(cloud).toHaveTextContent(/no key saved/i);
  });

  it("renders a section per server and a row per model", () => {
    render(<AiStatusPageView {...props} />);

    expect(screen.getByText("Server 01")).toBeInTheDocument();
    expect(screen.getByText("Server 02")).toBeInTheDocument();
    expect(screen.getByText("Qwen:9b-01")).toBeInTheDocument();
    expect(screen.getByText("Qwen:2b-02")).toBeInTheDocument();
    expect(screen.getByText("99.2%")).toBeInTheDocument();
  });

  it("states the window it is showing", () => {
    render(<AiStatusPageView {...props} />);
    expect(screen.getByText(/last 72 hours/i)).toBeInTheDocument();
  });

  it("keeps a no-data bucket distinct from an operational one", () => {
    const { container } = render(<AiStatusPageView {...props} />);
    const bars = container.querySelectorAll("[data-bucket-state]");

    expect(bars[0].getAttribute("data-bucket-state")).toBe("operational");
    expect(bars[1].getAttribute("data-bucket-state")).toBe("none");
    expect(bars[0].className).not.toBe(bars[1].className);
  });

  it("warns that the data is stale and stops claiming a current state", () => {
    render(<AiStatusPageView {...props} stale />);

    expect(screen.getByText(/status data is stale/i)).toBeInTheDocument();
    expect(
      screen.getAllByLabelText(/current state unknown — status data is stale/i).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByLabelText(/currently operational/i)).not.toBeInTheDocument();
  });

  it("explains an empty table as a cold start rather than showing nothing", () => {
    render(<AiStatusPageView {...props} payload={{ ...payload, servers: [] }} />);
    expect(screen.getByText(/no status history yet/i)).toBeInTheDocument();
  });

  it("names every state the bars can paint", () => {
    render(<AiStatusPageView {...props} />);

    for (const word of ["Operational", "Degraded", "Outage", "Unknown", "No data"]) {
      expect(screen.getAllByText(word).length).toBeGreaterThan(0);
    }
  });

  it("offers a refresh control that re-reads rather than reloading the page", () => {
    const onRefresh = vi.fn();
    render(<AiStatusPageView {...props} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
