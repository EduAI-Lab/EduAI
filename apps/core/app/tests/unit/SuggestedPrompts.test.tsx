import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SuggestedPrompts } from "~/components/chat/suggested-prompts";

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("SuggestedPrompts — rendering", () => {
  it("renders all six prompt titles", () => {
    render(<SuggestedPrompts onSelectPrompt={vi.fn()} />);
    expect(screen.getByText("Build a study plan")).toBeInTheDocument();
    expect(screen.getByText("Explain a concept")).toBeInTheDocument();
    expect(screen.getByText("Generate practice problems")).toBeInTheDocument();
    expect(screen.getByText("Review my essay")).toBeInTheDocument();
    expect(screen.getByText("Debug my code")).toBeInTheDocument();
    expect(screen.getByText("Summarize key points")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

describe("SuggestedPrompts — callbacks", () => {
  it("calls onSelectPrompt with the correct study plan prompt when 'Build a study plan' is clicked", () => {
    const onSelectPrompt = vi.fn();
    render(<SuggestedPrompts onSelectPrompt={onSelectPrompt} />);
    fireEvent.click(screen.getByText("Build a study plan"));
    expect(onSelectPrompt).toHaveBeenCalledWith(
      "Help me create a personalized study plan for my upcoming exam, including key topics to review and a day-by-day schedule."
    );
  });

  it("calls onSelectPrompt with the correct debug prompt when 'Debug my code' is clicked", () => {
    const onSelectPrompt = vi.fn();
    render(<SuggestedPrompts onSelectPrompt={onSelectPrompt} />);
    fireEvent.click(screen.getByText("Debug my code"));
    expect(onSelectPrompt).toHaveBeenCalledWith(
      "Help me debug this code, explain what's going wrong, and suggest a clean fix with an explanation."
    );
  });
});
