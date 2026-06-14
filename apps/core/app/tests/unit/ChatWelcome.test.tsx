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

  it("renders all four suggestion cards", () => {
    render(<ChatWelcome onSelectPrompt={vi.fn()} />);
    expect(screen.getByText("Explain this concept step by step")).toBeInTheDocument();
    expect(screen.getByText("Help me prepare for my exam")).toBeInTheDocument();
    expect(screen.getByText("Summarize this week's lecture")).toBeInTheDocument();
    expect(screen.getByText("Check my understanding")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

describe("ChatWelcome — callbacks", () => {
  it("calls onSelectPrompt with the correct prompt when a suggestion is clicked", () => {
    const onSelectPrompt = vi.fn();
    render(<ChatWelcome onSelectPrompt={onSelectPrompt} />);
    fireEvent.click(screen.getByText("Explain this concept step by step"));
    expect(onSelectPrompt).toHaveBeenCalledWith(
      "Explain a concept from my course step by step, using examples from the course materials."
    );
  });

  it("calls onSelectPrompt for each suggestion independently", () => {
    const onSelectPrompt = vi.fn();
    render(<ChatWelcome onSelectPrompt={onSelectPrompt} />);
    fireEvent.click(screen.getByText("Help me prepare for my exam"));
    expect(onSelectPrompt).toHaveBeenCalledWith(
      "Help me create a study plan and review key concepts for my upcoming exam."
    );
  });
});
