import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatTypingIndicator } from "~/components/chat/chat-typing-indicator";

describe("ChatTypingIndicator — rendering", () => {
  it("renders without crashing", () => {
    const { container } = render(<ChatTypingIndicator />);
    expect(container.firstChild).not.toBeNull();
  });

  it("renders the AI avatar fallback", () => {
    render(<ChatTypingIndicator />);
    expect(screen.getByText("AI")).toBeInTheDocument();
  });

  it("defaults to the thinking label when no stage is provided", () => {
    render(<ChatTypingIndicator />);
    // Visible shimmer + sr-only live region both carry the label.
    expect(screen.getAllByText(/eduai is thinking/i).length).toBeGreaterThan(0);
  });

  it("shows the stage label, elapsed time, and indeterminate progress (#1171)", () => {
    const { container } = render(
      <ChatTypingIndicator
        stage={{
          id: "waiting_for_model",
          label: "Waiting for model…",
          progress: 32,
        }}
        elapsedMs={12_400}
      />,
    );

    expect(screen.getAllByText(/waiting for model/i).length).toBeGreaterThan(0);
    expect(screen.getByText("12s")).toBeInTheDocument();
    expect(
      container.querySelector('[data-chat-progress-stage="waiting_for_model"]'),
    ).not.toBeNull();
    expect(
      screen.getByRole("progressbar", { name: /in progress: waiting for model/i }),
    ).toHaveAttribute("aria-valuetext", "Waiting for model…");
  });

  it("keeps elapsed outside the live region so AT is not spammed", () => {
    const { container } = render(
      <ChatTypingIndicator
        stage={{
          id: "waiting_for_model",
          label: "Waiting for model…",
          progress: 32,
        }}
        elapsedMs={5_000}
      />,
    );

    const live = container.querySelector("[aria-live='polite']");
    expect(live).not.toBeNull();
    expect(live?.textContent).toMatch(/Waiting for model/i);
    expect(live?.textContent).not.toMatch(/5s/);
  });

  it("renders a compact multi-step row without a second avatar bubble", () => {
    render(
      <ChatTypingIndicator
        compact
        stage={{
          id: "generating",
          label: "Generating…",
          progress: 72,
        }}
        elapsedMs={8_000}
      />,
    );

    expect(screen.queryByText("AI")).not.toBeInTheDocument();
    expect(screen.getByText("8s")).toBeInTheDocument();
    expect(
      document.querySelector('[data-chat-progress-compact="true"]'),
    ).not.toBeNull();
  });
});
