import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatWelcome } from "~/components/chat/chat-welcome";

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("ChatWelcome — rendering", () => {
  it("renders the welcome heading", () => {
    render(<ChatWelcome onSelectPrompt={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /what would you like to know/i })).toBeInTheDocument();
  });

  it("shows the model name when selectedModelInfo is provided", () => {
    render(
      <ChatWelcome
        selectedModelInfo={{ name: "GPT-4o", description: "Flagship model" }}
        onSelectPrompt={vi.fn()}
      />
    );
    expect(screen.getByText(/powered by gpt-4o/i)).toBeInTheDocument();
  });

  it("does not show 'Powered by' when selectedModelInfo is omitted", () => {
    render(<ChatWelcome onSelectPrompt={vi.fn()} />);
    expect(screen.queryByText(/powered by/i)).not.toBeInTheDocument();
  });

  it("renders all six suggestion cards from SuggestedPrompts", () => {
    render(<ChatWelcome onSelectPrompt={vi.fn()} />);
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

describe("ChatWelcome — callbacks", () => {
  it("calls onSelectPrompt with the correct prompt when a suggestion is clicked", () => {
    const onSelectPrompt = vi.fn();
    render(<ChatWelcome onSelectPrompt={onSelectPrompt} />);
    fireEvent.click(screen.getByText("Build a study plan"));
    expect(onSelectPrompt).toHaveBeenCalledWith(
      "Help me create a personalized study plan for my upcoming exam, including key topics to review and a day-by-day schedule."
    );
  });

  it("calls onSelectPrompt for each suggestion independently", () => {
    const onSelectPrompt = vi.fn();
    render(<ChatWelcome onSelectPrompt={onSelectPrompt} />);
    fireEvent.click(screen.getByText("Debug my code"));
    expect(onSelectPrompt).toHaveBeenCalledWith(
      "Help me debug this code, explain what's going wrong, and suggest a clean fix with an explanation."
    );
  });
});
