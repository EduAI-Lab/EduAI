import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AIServiceIndicators, isServiceActive } from "../ai-service-indicators";

describe("AIServiceIndicators", () => {
  it("reports each service state independently", () => {
    render(<AIServiceIndicators cloud={{ state: "operational" }} ubc={{ state: "outage" }} />);
    // Each chip's aria-label reflects only its own state — no cross-dependency.
    expect(screen.getByLabelText("Cloud AI: Operational")).toBeInTheDocument();
    expect(screen.getByLabelText("UBC-hosted AI: Outage")).toBeInTheDocument();
  });

  it("renders the degraded state (#1551)", () => {
    render(
      <AIServiceIndicators
        cloud={{ state: "operational" }}
        ubc={{ state: "degraded", detail: "UBC-hosted inference under heavy load." }}
      />,
    );
    const chip = screen.getByLabelText("UBC-hosted AI: Degraded");
    expect(chip).toBeInTheDocument();
    // Degraded is still "up" — the chip renders in the active (foreground) style.
    expect(chip.className).toContain("text-foreground");
  });

  it("renders loading and unknown states", () => {
    render(<AIServiceIndicators cloud={{ state: "loading" }} ubc={{ state: "unknown" }} />);
    expect(screen.getByLabelText("Cloud AI: Checking…")).toBeInTheDocument();
    expect(screen.getByLabelText("UBC-hosted AI: Unknown")).toBeInTheDocument();
  });

  it("calls onRefresh when a chip is clicked", () => {
    const onRefresh = vi.fn();
    render(
      <AIServiceIndicators
        cloud={{ state: "operational" }}
        ubc={{ state: "operational" }}
        onRefresh={onRefresh}
      />,
    );
    screen.getByLabelText("Cloud AI: Operational").click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("treats operational and degraded as active, others as inactive", () => {
    expect(isServiceActive("operational")).toBe(true);
    expect(isServiceActive("degraded")).toBe(true);
    expect(isServiceActive("outage")).toBe(false);
    expect(isServiceActive("loading")).toBe(false);
    expect(isServiceActive("unknown")).toBe(false);
  });
});
