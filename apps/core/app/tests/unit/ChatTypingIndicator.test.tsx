import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
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

  it("keeps countdown and elapsed outside the live region so AT is not spammed", () => {
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
    // Per-second remaining copy is visual-only (would spam AT every tick).
    expect(live?.textContent).not.toMatch(/About 15s left/i);
    expect(live?.textContent).not.toMatch(/5s elapsed/);
  });

  it("announces the discrete longer-than-usual state in the live region", () => {
    const { container } = render(
      <ChatTypingIndicator
        stage={{
          id: "waiting_for_model",
          label: "Waiting for model…",
          progress: 18,
        }}
        elapsedMs={48_000}
        timed={{
          percent: 91,
          expectedMs: 40_000,
          remainingMs: 0,
          isOverExpected: true,
          timingLabel: "Taking longer than usual",
        }}
      />,
    );

    const live = container.querySelector("[aria-live='polite']");
    expect(live?.textContent).toMatch(/Waiting for model/i);
    expect(live?.textContent).toMatch(/Taking longer than usual/i);
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

describe("ChatTypingIndicator — local timer (#1171 review)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks elapsed locally from startedAt without needing parent re-renders", () => {
    const startedAt = Date.now();
    const { container } = render(
      <ChatTypingIndicator
        startedAt={startedAt}
        deadlineMs={40_000}
        typicalExpectedMs={40_000}
        hasRoutedModel
        adhdAssist={false}
      />,
    );

    expect(
      container.querySelector('[data-chat-progress-stage="waiting_for_model"]'),
    ).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(7_000);
    });

    expect(screen.getAllByText(/7s elapsed/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/About .* left/i).length).toBeGreaterThan(0);
  });

  it("promotes to Working on Assist reply… after the Assist silence window", () => {
    const startedAt = Date.now();
    const { container } = render(
      <ChatTypingIndicator
        startedAt={startedAt}
        deadlineMs={50_000}
        typicalExpectedMs={50_000}
        hasRoutedModel
        adhdAssist
      />,
    );

    act(() => {
      vi.advanceTimersByTime(6_500);
    });

    expect(
      container.querySelector('[data-chat-progress-stage="preparing_assist"]'),
    ).not.toBeNull();
    expect(
      screen.getAllByText(/Working on Assist reply/i).length,
    ).toBeGreaterThan(0);
  });
});
