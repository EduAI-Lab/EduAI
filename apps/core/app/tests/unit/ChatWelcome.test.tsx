import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatWelcome } from "~/components/chat/chat-welcome";

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("ChatWelcome — rendering", () => {
  it("renders the welcome heading", () => {
    render(<ChatWelcome onSelectPrompt={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: /where should we begin/i }),
    ).toBeInTheDocument();
  });

  it("shows the model name when selectedModelInfo is provided", () => {
    render(
      <ChatWelcome
        selectedModelInfo={{ name: "GPT-4o", description: "Flagship model" }}
        onSelectPrompt={vi.fn()}
      />,
    );
    expect(screen.getByText("GPT-4o")).toBeInTheDocument();
  });

  it("shows course context when selectedCourseCode is provided", () => {
    render(
      <ChatWelcome
        selectedCourseCode="COSC 101"
        onSelectPrompt={vi.fn()}
      />,
    );
    expect(screen.getByText(/ask about cosc 101/i)).toBeInTheDocument();
  });

  it("renders four starter chips from SuggestedPrompts", () => {
    render(<ChatWelcome onSelectPrompt={vi.fn()} />);
    expect(screen.getByText("Explain a concept")).toBeInTheDocument();
    expect(screen.getByText("Build a study plan")).toBeInTheDocument();
    expect(screen.getByText("Practice problems")).toBeInTheDocument();
    expect(screen.getByText("Summarize readings")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

describe("ChatWelcome — callbacks", () => {
  it("calls onSelectPrompt with the correct prompt when a suggestion is clicked", () => {
    vi.useFakeTimers();
    const onSelectPrompt = vi.fn();
    render(<ChatWelcome onSelectPrompt={onSelectPrompt} />);
    fireEvent.click(screen.getByText("Build a study plan"));
    vi.advanceTimersByTime(280);
    expect(onSelectPrompt).toHaveBeenCalledWith(
      "Help me create a short study plan for my upcoming exam with the most important topics first.",
    );
    vi.useRealTimers();
  });

  it("calls onSelectPrompt for each suggestion independently", () => {
    vi.useFakeTimers();
    const onSelectPrompt = vi.fn();
    render(<ChatWelcome onSelectPrompt={onSelectPrompt} />);
    fireEvent.click(screen.getByText("Explain a concept"));
    vi.advanceTimersByTime(280);
    expect(onSelectPrompt).toHaveBeenCalledWith(
      "Explain a challenging concept from my course in simple terms with one real-world example.",
    );
    vi.useRealTimers();
  });
});
