import { fireEvent, render, screen } from "@testing-library/react";
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

  it("opens the ubcHistory popover when the UBC chip is clicked", () => {
    const onRefresh = vi.fn();
    render(
      <AIServiceIndicators
        cloud={{ state: "operational" }}
        ubc={{ state: "operational" }}
        ubcHistory={<div>UBC history panel content</div>}
        onRefresh={onRefresh}
      />,
    );

    const chip = screen.getByLabelText("UBC-hosted AI: Operational");
    // The chip itself must BE the popover trigger. Asserting only that the panel
    // appears is not enough: a chip that merely forwards an onClick prop will do
    // that while dropping the trigger's ref (so the popper has no anchor) and all
    // of its ARIA wiring.
    expect(chip).toHaveAttribute("aria-haspopup", "dialog");
    expect(chip).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("UBC history panel content")).not.toBeInTheDocument();

    fireEvent.click(chip);

    const panel = screen.getByText("UBC history panel content");
    const dialog = screen.getByRole("dialog");
    expect(dialog).toContainElement(panel);
    expect(chip).toHaveAttribute("aria-expanded", "true");
    expect(chip).toHaveAttribute("aria-controls", dialog.id);
    // The popover replaces the refresh click for this chip.
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("reports the UBC popover open state via onUbcOpenChange", () => {
    const onUbcOpenChange = vi.fn();
    render(
      <AIServiceIndicators
        cloud={{ state: "operational" }}
        ubc={{ state: "operational" }}
        ubcHistory={<div>UBC history panel content</div>}
        onUbcOpenChange={onUbcOpenChange}
      />,
    );

    const chip = screen.getByLabelText("UBC-hosted AI: Operational");

    fireEvent.click(chip);
    expect(onUbcOpenChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(chip);
    expect(onUbcOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("still shows the UBC tooltip while the history popover is wired up", () => {
    render(
      <AIServiceIndicators
        cloud={{ state: "operational" }}
        ubc={{ state: "degraded", detail: "UBC-hosted inference under heavy load." }}
        ubcHistory={<div>UBC history panel content</div>}
      />,
    );

    const chip = screen.getByLabelText("UBC-hosted AI: Degraded");
    expect(screen.queryByText("UBC-hosted inference under heavy load.")).not.toBeInTheDocument();
    fireEvent.focus(chip);
    expect(screen.getAllByText("UBC-hosted inference under heavy load.").length).toBeGreaterThan(0);
  });

  it("treats operational and degraded as active, others as inactive", () => {
    expect(isServiceActive("operational")).toBe(true);
    expect(isServiceActive("degraded")).toBe(true);
    expect(isServiceActive("outage")).toBe(false);
    expect(isServiceActive("loading")).toBe(false);
    expect(isServiceActive("unknown")).toBe(false);
  });
});
