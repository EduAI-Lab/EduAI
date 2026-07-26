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
    expect(screen.getAllByText(/eduai is thinking/i).length).toBeGreaterThan(0);
  });

  it("shows timed remaining copy and a determinate progress value (#1171)", () => {
    const { container } = render(
      <ChatTypingIndicator
        stage={{
          id: "waiting_for_model",
          label: "Waiting for model…",
          progress: 18,
        }}
        elapsedMs={12_000}
        timed={{
          percent: 55,
          expectedMs: 40_000,
          remainingMs: 28_000,
          isOverExpected: false,
          timingLabel: "About 28s left",
        }}
      />,
    );

    expect(screen.getAllByText(/waiting for model/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/About 28s left/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Usually ~40s/i)).toBeInTheDocument();
    expect(
      container.querySelector('[data-chat-progress-percent="55"]'),
    ).not.toBeNull();
    const bar = screen.getByRole("progressbar", {
      name: /response progress: waiting for model/i,
    });
    expect(bar).toHaveAttribute("aria-valuenow", "55");
    expect(bar.getAttribute("aria-valuetext") ?? "").toMatch(/About 28s left/i);
  });

  it("keeps elapsed outside the live region so AT is not spammed", () => {
    const { container } = render(
      <ChatTypingIndicator
        stage={{
          id: "waiting_for_model",
          label: "Waiting for model…",
          progress: 18,
        }}
        elapsedMs={5_000}
        timed={{
          percent: 30,
          expectedMs: 20_000,
          remainingMs: 15_000,
          isOverExpected: false,
          timingLabel: "About 15s left",
        }}
      />,
    );

    const live = container.querySelector("[aria-live='polite']");
    expect(live).not.toBeNull();
    expect(live?.textContent).toMatch(/Waiting for model/i);
    expect(live?.textContent).toMatch(/About 15s left/i);
    expect(live?.textContent).not.toMatch(/5s elapsed/);
  });

  it("renders a compact multi-step row without a second avatar bubble", () => {
    render(
      <ChatTypingIndicator
        compact
        stage={{
          id: "generating",
          label: "Generating…",
          progress: 58,
        }}
        elapsedMs={8_000}
        timed={{
          percent: 70,
          expectedMs: 12_000,
          remainingMs: 4_000,
          isOverExpected: false,
          timingLabel: "About 4s left",
        }}
      />,
    );

    expect(screen.queryByText("AI")).not.toBeInTheDocument();
    expect(screen.getAllByText(/About 4s left/i).length).toBeGreaterThan(0);
    expect(
      document.querySelector('[data-chat-progress-compact="true"]'),
    ).not.toBeNull();
  });
});
