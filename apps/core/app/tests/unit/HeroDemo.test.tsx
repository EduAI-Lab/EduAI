import { describe, it, expect, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";

import { HeroDemo } from "~/components/hero-demo";

/**
 * The hero reel is scripted on timers, so every assertion here drives fake
 * timers forward rather than waiting on real time. Covers the two things that
 * would silently break the landing page: the autoplay hand-off between the
 * three tools, and the tab jump that replays a tool without stalling the reel.
 */
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("HeroDemo", () => {
  it("plays the EduAI scene first, then hands off to Question Maker", () => {
    vi.useFakeTimers();
    render(<HeroDemo />);

    expect(screen.getByText("Course chat · CHEM 121")).toBeInTheDocument();

    // Long enough for every beat, the hold, and the exit transition.
    act(() => {
      vi.advanceTimersByTime(12_000);
    });

    expect(screen.getByText("Question bank · PHYS 111")).toBeInTheDocument();
  });

  it("swaps the AI Tutor option chips in place rather than stacking a second row", () => {
    vi.useFakeTimers();
    render(<HeroDemo />);

    fireEvent.click(screen.getByRole("button", { name: "AI Tutor" }));
    act(() => {
      vi.advanceTimersByTime(6_000);
    });

    // One chip per option: the pick restyles the existing row.
    expect(screen.getAllByText("Multiply by mass")).toHaveLength(1);
  });

  it("holds a beat's typed line until that beat is revealed", () => {
    vi.useFakeTimers();
    render(<HeroDemo />);

    // "Show me the rate expression." is the EduAI scene's last typed line,
    // scheduled ~4.3s in. Its wrapper mounts with the scene, so a typewriter
    // started on mount would have finished it (28 chars at 26ms) long before
    // the beat is revealed, and it would appear fully formed instead of typing.
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.queryByText("Show me the rate expression.")).not.toBeInTheDocument();

    // Revealing the beat is what starts its reveal interval, so the typing
    // ticks belong to a later flush than the timer that revealed it.
    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText("Show me the rate expression.")).toBeInTheDocument();
  });

  it("jumps to the picked tool and keeps the reel rotating from there", () => {
    vi.useFakeTimers();
    render(<HeroDemo />);

    fireEvent.click(screen.getByRole("button", { name: "AI Tutor" }));
    expect(screen.getByText("Study buddy · Unit 3 practice")).toBeInTheDocument();

    // The picked scene replays from the top, then hands off like any other.
    act(() => {
      vi.advanceTimersByTime(12_000);
    });

    expect(screen.getByText("Course chat · CHEM 121")).toBeInTheDocument();
  });
});
