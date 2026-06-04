import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatWelcome } from "~/components/chat/chat-welcome";

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("ChatWelcome — rendering", () => {
  it("renders the welcome heading", () => {
    render(<ChatWelcome onSelectPrompt={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /welcome to eduai/i })).toBeInTheDocument();
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

  it("renders all six suggestion cards", () => {
    render(<ChatWelcome onSelectPrompt={vi.fn()} />);
    expect(screen.getByText("Creative Ideas")).toBeInTheDocument();
    expect(screen.getByText("Code Review")).toBeInTheDocument();
    expect(screen.getByText("Learning Path")).toBeInTheDocument();
    expect(screen.getByText("Problem Solving")).toBeInTheDocument();
    expect(screen.getByText("Design Ideas")).toBeInTheDocument();
    expect(screen.getByText("Research & Analysis")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

describe("ChatWelcome — callbacks", () => {
  it("calls onSelectPrompt with the correct prompt when a suggestion is clicked", () => {
    const onSelectPrompt = vi.fn();
    render(<ChatWelcome onSelectPrompt={onSelectPrompt} />);
    fireEvent.click(screen.getByText("Creative Ideas"));
    expect(onSelectPrompt).toHaveBeenCalledWith(
      "Help me brainstorm creative solutions for organizing a virtual team building event"
    );
  });

  it("calls onSelectPrompt for each suggestion independently", () => {
    const onSelectPrompt = vi.fn();
    render(<ChatWelcome onSelectPrompt={onSelectPrompt} />);
    fireEvent.click(screen.getByText("Code Review"));
    expect(onSelectPrompt).toHaveBeenCalledWith(
      "Review my React component and suggest improvements for performance and readability"
    );
  });
});
