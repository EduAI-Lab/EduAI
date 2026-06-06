import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatTypingIndicator } from "~/components/chat/chat-typing-indicator";

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("ChatTypingIndicator — rendering", () => {
  it("renders without crashing", () => {
    const { container } = render(<ChatTypingIndicator />);
    expect(container.firstChild).not.toBeNull();
  });

  it("renders the AI avatar fallback", () => {
    render(<ChatTypingIndicator />);
    expect(screen.getByText("AI")).toBeInTheDocument();
  });

  it("renders the 'EduAI is thinking' loader text", () => {
    render(<ChatTypingIndicator />);
    expect(screen.getByText(/eduai is thinking/i)).toBeInTheDocument();
  });
});
