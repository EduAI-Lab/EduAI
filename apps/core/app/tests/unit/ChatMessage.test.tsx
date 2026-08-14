import { describe, it, expect, vi, beforeAll } from "vitest";
import { fireEvent, render, screen} from "@testing-library/react";
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

  it("renders an animated eduai-diagram widget instead of a code fence", () => {
    const withDiagram: Message = {
      ...aiMessage,
      content: `Intro

\`\`\`eduai-diagram
gradient-descent
\`\`\`

Outro`,
    };
    const { container } = render(
      <ChatMessage message={withDiagram} assistiveDisplay />,
    );
    expect(container.querySelector('[data-eduai-diagram="gradient-descent"]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /replay/i })).toBeInTheDocument();
    expect(screen.queryByText(/```eduai-diagram/)).not.toBeInTheDocument();
  });

  it("does not turn eduai-diagram fences into widgets outside Assist mode", () => {
    const withDiagram: Message = {
      ...aiMessage,
      content: `\`\`\`eduai-diagram
process-flow
title: Baseline
Introduce: Step one
\`\`\``,
    };
    const { container } = render(<ChatMessage message={withDiagram} />);
    expect(container.querySelector("[data-eduai-diagram]")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /replay/i })).not.toBeInTheDocument();
  });

  it("renders labeled process-flow stages and shows detail on tap", () => {
    const withDiagram: Message = {
      ...aiMessage,
      content: `\`\`\`eduai-diagram
process-flow
title: How a bill becomes law
Introduce bill: Member files the proposal
Committee: Experts study and amend
Floor vote: Chamber decides
Become law: President signs
\`\`\``,
    };
    const { container } = render(
      <ChatMessage message={withDiagram} assistiveDisplay />,
    );
    const diagram = container.querySelector('[data-eduai-diagram="process-flow"]');
    expect(diagram).toBeInTheDocument();
    expect(screen.getByText("How a bill becomes law")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Committee" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Committee" }));
    expect(diagram?.textContent).toMatch(/Committee\s+—\s+Experts study and amend/);
  });

  it("keeps process-flow stage selection after autoplay timers fire", () => {
    vi.useFakeTimers();
    const withDiagram: Message = {
      ...aiMessage,
      content: `\`\`\`eduai-diagram
process-flow
title: Bill
Introduce Bill: file
Committee: review
Vote: decide
Law: sign
\`\`\``,
    };
    const { container } = render(
      <ChatMessage message={withDiagram} assistiveDisplay />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Committee" }));
    const diagram = container.querySelector('[data-eduai-diagram="process-flow"]');
    expect(diagram?.textContent).toMatch(/Committee\s+—\s+review/);
    vi.advanceTimersByTime(5000);
    // Detail panel must still describe Committee, not the last autoplay stage.
    expect(diagram?.textContent).toMatch(/Committee\s+—\s+review/);
    expect(diagram?.textContent).not.toMatch(/Law\s+—\s+sign/);
    vi.useRealTimers();
  });

  it("renders gradient-descent stage chips and detail on tap", () => {
    const withDiagram: Message = {
      ...aiMessage,
      content: `\`\`\`eduai-diagram
gradient-descent
title: Gradient descent
Start high: Pick a starting point
Compute slope: Measure steepness
Step downhill: Move opposite the slope
\`\`\``,
    };
    const { container } = render(
      <ChatMessage message={withDiagram} assistiveDisplay />,
    );
    const diagram = container.querySelector('[data-eduai-diagram="gradient-descent"]');
    expect(diagram).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Compute slope" }));
    expect(diagram?.textContent).toMatch(/Compute slope\s+—\s+Measure steepness/);
  });

  it("renders hierarchy and compare stage detail on tap", () => {
    const hierarchy: Message = {
      ...aiMessage,
      id: "h",
      content: `\`\`\`eduai-diagram
hierarchy
title: Neuron
Neuron: Whole cell
Dendrites: Receive
Axon: Send
\`\`\``,
    };
    const { container, unmount } = render(
      <ChatMessage message={hierarchy} assistiveDisplay />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dendrites" }));
    expect(
      container.querySelector('[data-eduai-diagram="hierarchy"]')?.textContent,
    ).toMatch(/Dendrites\s+—\s+Receive/);
    unmount();

    const compare: Message = {
      ...aiMessage,
      id: "c",
      content: `\`\`\`eduai-diagram
compare
title: TCP vs UDP
TCP: Reliable
UDP: Fast
\`\`\``,
    };
    const compareRender = render(
      <ChatMessage message={compare} assistiveDisplay />,
    );
    fireEvent.click(screen.getByRole("button", { name: "UDP" }));
    expect(
      compareRender.container.querySelector('[data-eduai-diagram="compare"]')
        ?.textContent,
    ).toMatch(/UDP\s+—\s+Fast/);
  });

  it("falls back unknown type ids to process-flow animation", () => {
    const withDiagram: Message = {
      ...aiMessage,
      content: "```eduai-diagram\nphotosynthesis-cycle\n```",
    };
    const { container } = render(
      <ChatMessage message={withDiagram} assistiveDisplay />,
    );
    expect(container.querySelector('[data-eduai-diagram="process-flow"]')).toBeInTheDocument();
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

  it("progressively relabels Assist headings mid-stream without waiting for Next? (#1171)", () => {
    const partialAssist: Message = {
      ...aiMessage,
      content: "**Top summary**\n- Only half so far",
    };
    render(
      <ChatMessage
        message={partialAssist}
        isStreaming
        assistiveDisplay
      />,
    );
    // Progressive relabel — no final-frame snap waiting for Next?.
    expect(screen.getByText(/TLDR/i)).toBeInTheDocument();
    expect(screen.queryByText(/Top summary/i)).not.toBeInTheDocument();
  });

  it("relabels Next?-only redirect turns mid-stream (#1171)", () => {
    const redirect: Message = {
      ...aiMessage,
      content: "**Next?** Want to try a different angle?",
    };
    render(
      <ChatMessage message={redirect} isStreaming assistiveDisplay />,
    );
    expect(screen.getByText(/Continue/i)).toBeInTheDocument();
    expect(screen.queryByText(/\*\*Next\?/i)).not.toBeInTheDocument();
  });

  it("applies full Assist reorder when a complete dump arrives while streaming", () => {
    const completeAssist: Message = {
      ...aiMessage,
      content: "**Top summary**\n- Point\n\n**Next?** Want to continue?",
    };
    render(
      <ChatMessage
        message={completeAssist}
        isStreaming
        assistiveDisplay
      />,
    );
    expect(screen.getByText(/TLDR/i)).toBeInTheDocument();
    expect(screen.getByText(/Continue/i)).toBeInTheDocument();
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