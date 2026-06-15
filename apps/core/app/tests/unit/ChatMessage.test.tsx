import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatMessage, coerceMessageContent } from "~/components/chat/chat-message";
import type { Message } from "ai";

beforeAll(() => {
  vi.stubGlobal("navigator", {
    ...navigator,
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

// ---------------------------------------------------------------------------
// coerceMessageContent — unit tests for the content-coercion helper
// ---------------------------------------------------------------------------

describe("coerceMessageContent", () => {
  it("returns a string as-is", () => {
    expect(coerceMessageContent("hello")).toBe("hello");
  });

  it("returns empty string for null", () => {
    expect(coerceMessageContent(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(coerceMessageContent(undefined)).toBe("");
  });

  it("extracts .text from a plain object (DB-revived JSON content)", () => {
    expect(coerceMessageContent({ text: "restored text" })).toBe("restored text");
  });

  it("joins text parts from an array of AI-SDK parts", () => {
    const parts = [
      { type: "text", text: "Hello" },
      { type: "text", text: "World" },
    ];
    expect(coerceMessageContent(parts)).toBe("Hello\nWorld");
  });

  it("skips non-text parts in an array", () => {
    const parts = [
      { type: "tool-invocation", toolInvocation: {} },
      { type: "text", text: "Only this" },
    ];
    expect(coerceMessageContent(parts)).toBe("Only this");
  });

  it("falls back to JSON.stringify for an unrecognised object", () => {
    const obj = { someField: 42 };
    expect(coerceMessageContent(obj)).toBe(JSON.stringify(obj));
  });

  it("never returns a value that would render as [object Object]", () => {
    const result = coerceMessageContent({ role: "assistant" });
    expect(typeof result).toBe("string");
    expect(result).not.toBe("[object Object]");
  });
});
