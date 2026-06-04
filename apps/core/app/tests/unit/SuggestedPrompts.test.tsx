import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SuggestedPrompts } from "~/components/chat/suggested-prompts";

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("SuggestedPrompts — rendering", () => {
  it("renders the Quick Start heading", () => {
    render(<SuggestedPrompts onSelectPrompt={vi.fn()} />);
    expect(screen.getByText("Quick Start")).toBeInTheDocument();
  });

  it("renders all six suggestion titles", () => {
    render(<SuggestedPrompts onSelectPrompt={vi.fn()} />);
    expect(screen.getByText("Creative Ideas")).toBeInTheDocument();
    expect(screen.getByText("Code Review")).toBeInTheDocument();
    expect(screen.getByText("Learning Path")).toBeInTheDocument();
    expect(screen.getByText("Problem Solving")).toBeInTheDocument();
    expect(screen.getByText("Design Ideas")).toBeInTheDocument();
    expect(screen.getByText("Research & Analysis")).toBeInTheDocument();
  });

  it("renders all six suggestion descriptions", () => {
    render(<SuggestedPrompts onSelectPrompt={vi.fn()} />);
    expect(screen.getByText("Brainstorm innovative solutions and concepts")).toBeInTheDocument();
    expect(screen.getByText("Get help with programming and development")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

describe("SuggestedPrompts — callbacks", () => {
  it("calls onSelectPrompt with the correct prompt when a card is clicked", () => {
    const onSelectPrompt = vi.fn();
    render(<SuggestedPrompts onSelectPrompt={onSelectPrompt} />);
    fireEvent.click(screen.getByText("Creative Ideas"));
    expect(onSelectPrompt).toHaveBeenCalledWith(
      "Help me brainstorm creative solutions for organizing a virtual team building event"
    );
  });

  it("calls onSelectPrompt with a different prompt per card", () => {
    const onSelectPrompt = vi.fn();
    render(<SuggestedPrompts onSelectPrompt={onSelectPrompt} />);
    fireEvent.click(screen.getByText("Learning Path"));
    expect(onSelectPrompt).toHaveBeenCalledWith(
      "Create a 30-day learning plan for mastering TypeScript from beginner to intermediate level"
    );
  });
});
