import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent} from "@testing-library/react";
import {
  ChatMessage,
  coerceMessageContent,
} from "~/components/chat/chat-message";
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

  it("renders in a muted bubble (flat transcript layout)", () => {
    const { container } = render(<ChatMessage message={userMessage} />);
    expect(container.querySelector(".rounded-2xl.bg-muted\\/60")).toBeInTheDocument();
  });

  it("does not render legacy avatar labels", () => {
    render(<ChatMessage message={userMessage} />);
    expect(screen.queryByText("U")).not.toBeInTheDocument();
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

  it("does not render legacy avatar labels", () => {
    render(<ChatMessage message={aiMessage} />);
    expect(screen.queryByText("AI")).not.toBeInTheDocument();
  });

  it("renders a copy button", () => {
    render(<ChatMessage message={aiMessage} />);

    expect(
      screen.getByRole("button", { name: /copy/i }),
    ).toBeInTheDocument();
  });

  it("marks AI message content as a reading surface", () => {
    const { container } = render(<ChatMessage message={aiMessage} />);
    expect(container.querySelector(".reading-surface")).toBeInTheDocument();
  });

  it("applies active highlight class when highlightRole is active", () => {
    const { container } = render(
      <ChatMessage message={aiMessage} highlightRole="active" />,
    );
    expect(container.querySelector(".chat-message--active")).toBeInTheDocument();
  });

  it("applies inactive highlight class when highlightRole is inactive", () => {
    const { container } = render(
      <ChatMessage message={aiMessage} highlightRole="inactive" />,
    );
    expect(container.querySelector(".chat-message--inactive")).toBeInTheDocument();
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

// ---------------------------------------------------------------------------
// Continue affordance
// ---------------------------------------------------------------------------

describe("ChatMessage — Continue affordance", () => {
  it("shows Continue when requested", () => {
    const onContinue = vi.fn();

    render(
      <ChatMessage
        message={aiMessage}
        showContinue
        onContinue={onContinue}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Continue" }),
    ).toBeInTheDocument();
  });

  it("calls onContinue when clicked", () => {
    const onContinue = vi.fn();

    render(
      <ChatMessage
        message={aiMessage}
        showContinue
        onContinue={onContinue}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Continue" }),
    );

    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("does not show Continue by default", () => {
    render(<ChatMessage message={aiMessage} />);

    expect(
      screen.queryByRole("button", { name: "Continue" }),
    ).not.toBeInTheDocument();
  });

  it("disables Continue while loading", () => {
    render(
      <ChatMessage
        message={aiMessage}
        showContinue
        onContinue={vi.fn()}
        continueDisabled
      />,
    );

    expect(
      screen.getByRole("button", { name: "Continue" }),
    ).toBeDisabled();
  });
});