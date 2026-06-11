import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatMessage } from "~/components/chat/chat-message";
import type { Message } from "ai";

beforeAll(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

const userMessage: Message = {
  id: "1",
  role: "user",
  content: "Hello from user",
  createdAt: new Date(),
};

const aiMessage: Message = {
  id: "2",
  role: "assistant",
  content: "Hello from AI",
  createdAt: new Date(),
};

// ---------------------------------------------------------------------------
// User messages
// ---------------------------------------------------------------------------

describe("ChatMessage — user message", () => {
  it("renders the text content", () => {
    render(<ChatMessage message={userMessage} />);
    expect(screen.getByText("Hello from user")).toBeInTheDocument();
  });

  it("renders with right-aligned layout", () => {
    const { container } = render(<ChatMessage message={userMessage} />);
    expect(container.querySelector(".flex.justify-end")).toBeInTheDocument();
  });

  it("renders a 'U' avatar fallback", () => {
    render(<ChatMessage message={userMessage} />);
    expect(screen.getByText("U")).toBeInTheDocument();
  });

  it("marks user message text as a reading surface", () => {
    const { container } = render(<ChatMessage message={userMessage} />);
    expect(container.querySelector(".reading-surface")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AI messages
// ---------------------------------------------------------------------------

describe("ChatMessage — AI message", () => {
  it("renders the text content", () => {
    render(<ChatMessage message={aiMessage} />);
    expect(screen.getByText("Hello from AI")).toBeInTheDocument();
  });

  it("renders an 'AI' avatar fallback", () => {
    render(<ChatMessage message={aiMessage} />);
    expect(screen.getByText("AI")).toBeInTheDocument();
  });

  it("renders a copy button", () => {
    render(<ChatMessage message={aiMessage} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("marks AI message content as a reading surface", () => {
    const { container } = render(<ChatMessage message={aiMessage} />);
    expect(container.querySelector(".reading-surface")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Streaming state
// ---------------------------------------------------------------------------

describe("ChatMessage — streaming", () => {
  it("renders streamed AI content", () => {
    const streamingMessage: Message = { ...aiMessage, content: "Partial response..." };
    render(<ChatMessage message={streamingMessage} isStreaming={true} />);
    expect(screen.getByText("Partial response...")).toBeInTheDocument();
  });
});
