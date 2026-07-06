import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SuggestedPrompts } from "~/components/chat/suggested-prompts";

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("SuggestedPrompts — rendering", () => {
  it("renders four starter chip labels", () => {
    render(<SuggestedPrompts onSelectPrompt={vi.fn()} />);
    expect(screen.getByText("Build a study plan")).toBeInTheDocument();
    expect(screen.getByText("Explain a concept")).toBeInTheDocument();
    expect(screen.getByText("Practice problems")).toBeInTheDocument();
    expect(screen.getByText("Summarize readings")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

describe("SuggestedPrompts — callbacks", () => {
  it("calls onSelectPrompt with the correct study plan prompt when 'Build a study plan' is clicked", () => {
    vi.useFakeTimers();
    const onSelectPrompt = vi.fn();
    render(<SuggestedPrompts onSelectPrompt={onSelectPrompt} />);
    fireEvent.click(screen.getByText("Build a study plan"));
    expect(onSelectPrompt).not.toHaveBeenCalled();
    vi.advanceTimersByTime(280);
    expect(onSelectPrompt).toHaveBeenCalledWith(
      "Help me create a short study plan for my upcoming exam with the most important topics first.",
    );
    vi.useRealTimers();
  });

  it("calls onSelectPrompt with the correct concept prompt when 'Explain a concept' is clicked", () => {
    vi.useFakeTimers();
    const onSelectPrompt = vi.fn();
    render(<SuggestedPrompts onSelectPrompt={onSelectPrompt} />);
    fireEvent.click(screen.getByText("Explain a concept"));
    vi.advanceTimersByTime(280);
    expect(onSelectPrompt).toHaveBeenCalledWith(
      "Explain a challenging concept from my course in simple terms with one real-world example.",
    );
    vi.useRealTimers();
  });
});
