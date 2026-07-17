import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AIServiceIndicators } from "../ai-service-indicators";

describe("AIServiceIndicators", () => {
  it("reports each service state independently", () => {
    render(
      <AIServiceIndicators
        cloud={{ state: "online" }}
        ubc={{ state: "offline" }}
      />,
    );
    // Each chip's aria-label reflects only its own state — no cross-dependency.
    expect(screen.getByLabelText("Cloud AI: Online")).toBeInTheDocument();
    expect(screen.getByLabelText("UBC-hosted AI: Offline")).toBeInTheDocument();
  });

  it("renders loading and unknown states", () => {
    render(
      <AIServiceIndicators cloud={{ state: "loading" }} ubc={{ state: "unknown" }} />,
    );
    expect(screen.getByLabelText("Cloud AI: Checking…")).toBeInTheDocument();
    expect(screen.getByLabelText("UBC-hosted AI: Unknown")).toBeInTheDocument();
  });

  it("calls onRefresh when a chip is clicked", () => {
    const onRefresh = vi.fn();
    render(
      <AIServiceIndicators
        cloud={{ state: "online" }}
        ubc={{ state: "online" }}
        onRefresh={onRefresh}
      />,
    );
    screen.getByLabelText("Cloud AI: Online").click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
