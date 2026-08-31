import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ChatConversationLayout } from "~/components/chat/chat-conversation-layout";
import { UiPreferencesProvider } from "~/components/assistive/ui-preferences-provider";
import { CHAT_SCROLL_PANE_CLASS } from "~/components/chat/chat-scroll-pane";
import {
  resolvedModelIdFromMessage,
  wasAutoRoutedFromMessage,
  adhdAssistFromMessage,
} from "~/lib/chat/chat-message-metadata";

const baseProps = {
  bannerTitle: "Chat",
  bannerDescription: "Chat",
  showCourseSelector: true,
  assistive: false,
  onAssistiveChange: vi.fn(),
  focusMode: false,
  onFocusModeChange: vi.fn(),
  chatModels: [],
  selectedModel: "",
  setSelectedModel: vi.fn(),
  selectedModelInfo: undefined,
  selectedCourseCode: null,
  setSelectedCourseCode: vi.fn(),
  availableCourses: [],
  messages: [],
  input: "",
  isLoading: false,
  adhdAssist: false,
  webToolsEnabled: false,
  systemPrompt: null,
  onSystemPromptSave: vi.fn(),
  onInputChange: vi.fn(),
  onSubmit: vi.fn(),
  onStop: vi.fn(),
  onSelectPrompt: vi.fn(),
  isStudentWithCourseChat: false,
  disabledReason: undefined,
};

describe("ChatConversationLayout — empty state layout", () => {
  it("does not clip overflowing welcome content behind the input bar", () => {
    const { container } = render(<ChatConversationLayout {...baseProps} />);
    // justify-center on an overflow-y-auto ancestor clips top content when it
    // doesn't fit — see Task 4 root-cause note in the mobile-fixes plan.
    const centeredWithJustify = container.querySelector(".flex-1.flex-col.justify-center");
    expect(centeredWithJustify).toBeNull();
  });

  it("wraps the welcome content in a safe-centering (margin-auto) container", () => {
    const { container } = render(<ChatConversationLayout {...baseProps} />);
    const safeCentered = container.querySelector(".my-auto");
    expect(safeCentered).not.toBeNull();
  });

  it("fills the shell pane instead of re-calculating 100vh (no scroll past composer)", () => {
    const { container } = render(<ChatConversationLayout {...baseProps} />);
    const root = container.firstElementChild as HTMLElement | null;
    expect(root?.className).toMatch(/\bh-full\b/);
    expect(root?.className).toMatch(/\bmin-h-0\b/);
    expect(root?.className).not.toMatch(/100vh/);
  });

  it("uses the shared #1320 scroll-pane class including overflow-x-hidden", () => {
    const { container } = render(<ChatConversationLayout {...baseProps} />);
    const pane = container.querySelector(".overflow-x-hidden.overflow-y-auto");
    expect(pane).not.toBeNull();
    expect(pane?.className).toBe(CHAT_SCROLL_PANE_CLASS);
  });

  it("leaves smooth scrolling to the stick-to-bottom hook, not CSS (#1517)", () => {
    // `scroll-behavior: smooth` in CSS overrides a programmatic
    // `behavior: "auto"`, animating every streamed token.
    expect(CHAT_SCROLL_PANE_CLASS).not.toMatch(/\bscroll-smooth\b/);
  });
});

describe("ChatConversationLayout — stick to bottom (#1517)", () => {
  it("scrolls the transcript to the bottom when a streamed token grows it", () => {
    const { container, rerender } = render(
      <ChatConversationLayout
        {...baseProps}
        messages={[{ id: "a1", role: "assistant", content: "Streaming" }]}
        isLoading
      />,
    );

    const pane = container.querySelector(".overflow-x-hidden.overflow-y-auto") as HTMLElement;
    Object.defineProperty(pane, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(pane, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(pane, "scrollTop", { value: 600, writable: true, configurable: true });
    const scrollTo = vi.fn();
    pane.scrollTo = scrollTo as unknown as HTMLElement["scrollTo"];

    // A streamed token: same message id, longer text, new array identity.
    rerender(
      <ChatConversationLayout
        {...baseProps}
        messages={[{ id: "a1", role: "assistant", content: "Streaming more" }]}
        isLoading
      />,
    );

    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "auto" });
  });

  it("hides the jump-to-latest button while pinned to the bottom", () => {
    render(
      <ChatConversationLayout
        {...baseProps}
        messages={[{ id: "a1", role: "assistant", content: "Answer" }]}
      />,
    );

    expect(screen.queryByRole("button", { name: /jump to latest/i })).not.toBeInTheDocument();
  });

  it("offers a jump-to-latest button once the reader scrolls up", () => {
    const { container } = render(
      <ChatConversationLayout
        {...baseProps}
        messages={[{ id: "a1", role: "assistant", content: "Answer" }]}
      />,
    );

    const pane = container.querySelector(".overflow-x-hidden.overflow-y-auto") as HTMLElement;
    Object.defineProperty(pane, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(pane, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(pane, "scrollTop", { value: 0, writable: true, configurable: true });

    act(() => {
      pane.dispatchEvent(new Event("scroll"));
    });

    expect(screen.getByRole("button", { name: /jump to latest/i })).toBeInTheDocument();
  });

  it("scrolls smoothly back to the bottom when the jump button is clicked", () => {
    const { container } = render(
      <ChatConversationLayout
        {...baseProps}
        messages={[{ id: "a1", role: "assistant", content: "Answer" }]}
      />,
    );

    const pane = container.querySelector(".overflow-x-hidden.overflow-y-auto") as HTMLElement;
    Object.defineProperty(pane, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(pane, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(pane, "scrollTop", { value: 0, writable: true, configurable: true });
    const scrollTo = vi.fn();
    pane.scrollTo = scrollTo as unknown as HTMLElement["scrollTo"];

    act(() => {
      pane.dispatchEvent(new Event("scroll"));
    });

    act(() => {
      screen.getByRole("button", { name: /jump to latest/i }).click();
    });

    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });
    expect(screen.queryByRole("button", { name: /jump to latest/i })).not.toBeInTheDocument();
  });

  it("jumps without animating for a reader who has asked for reduced motion", () => {
    const { container } = render(
      <UiPreferencesProvider initialMotionReduced initialDensity="comfortable">
        <ChatConversationLayout
          {...baseProps}
          messages={[{ id: "a1", role: "assistant", content: "Answer" }]}
        />
      </UiPreferencesProvider>,
    );

    const pane = container.querySelector(".overflow-x-hidden.overflow-y-auto") as HTMLElement;
    Object.defineProperty(pane, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(pane, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(pane, "scrollTop", { value: 0, writable: true, configurable: true });
    const scrollTo = vi.fn();
    pane.scrollTo = scrollTo as unknown as HTMLElement["scrollTo"];

    act(() => {
      pane.dispatchEvent(new Event("scroll"));
    });

    act(() => {
      screen.getByRole("button", { name: /jump to latest/i }).click();
    });

    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "auto" });
  });

  it("does not offer the jump button on an empty transcript", () => {
    const { container } = render(<ChatConversationLayout {...baseProps} />);

    const pane = container.querySelector(".overflow-x-hidden.overflow-y-auto") as HTMLElement;
    Object.defineProperty(pane, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(pane, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(pane, "scrollTop", { value: 0, writable: true, configurable: true });

    act(() => {
      pane.dispatchEvent(new Event("scroll"));
    });

    expect(screen.queryByRole("button", { name: /jump to latest/i })).not.toBeInTheDocument();
  });
});

describe("ChatConversationLayout — routed model labels", () => {
  it("keeps a message-owned label visible when the picker changes", () => {
    render(
      <ChatConversationLayout
        {...baseProps}
        selectedModel="google:gemini-2.5-pro"
        chatModels={[
          {
            id: "openai:gpt-4o",
            name: "GPT-4o",
            description: "OpenAI model",
            provider: "openai",
          },
        ]}
        messages={[{ id: "assistant-1", role: "assistant", content: "Persisted answer" }]}
        routedModelByMessageId={{ "assistant-1": "openai:gpt-4o" }}
      />,
    );

    expect(screen.getByText("Answered by GPT-4o")).toBeInTheDocument();
  });

  it("does not expose the routed vLLM model for an auto-routed reply", () => {
    render(
      <ChatConversationLayout
        {...baseProps}
        selectedModel="auto"
        messages={[{ id: "assistant-stream", role: "assistant", content: "Streaming" }]}
        isLoading
        streamingRoutedRegistryId="vllm:qwen2.5-7b-instruct"
        streamingWasAutoRouted
      />,
    );

    expect(screen.queryByText(/Answered by/i)).not.toBeInTheDocument();
  });

  it("keeps a persisted auto-routed message's label hidden after the picker is switched to an explicit model (#829)", () => {
    render(
      <ChatConversationLayout
        {...baseProps}
        selectedModel="vllm:qwen2.5-7b-instruct"
        messages={[{ id: "assistant-1", role: "assistant", content: "Auto-routed answer" }]}
        routedModelByMessageId={{ "assistant-1": "vllm:qwen2.5-7b-instruct" }}
        wasAutoRoutedByMessageId={{ "assistant-1": true }}
      />,
    );

    expect(screen.queryByText(/Answered by/i)).not.toBeInTheDocument();
  });

  it("still shows a persisted explicit-model message's label after the picker is switched to auto", () => {
    render(
      <ChatConversationLayout
        {...baseProps}
        selectedModel="auto"
        chatModels={[
          {
            id: "openai:gpt-4o",
            name: "GPT-4o",
            description: "OpenAI model",
            provider: "openai",
          },
        ]}
        messages={[{ id: "assistant-1", role: "assistant", content: "Explicit answer" }]}
        routedModelByMessageId={{ "assistant-1": "openai:gpt-4o" }}
        wasAutoRoutedByMessageId={{ "assistant-1": false }}
      />,
    );

    expect(screen.getByText("Answered by GPT-4o")).toBeInTheDocument();
  });

  it("keeps an auto-routed reply's label hidden after a reload with no live selector state (#829)", () => {
    // Simulates ChatScreen's hydration path: a DB-loaded transcript, not a
    // client session that ever saw the picker change.
    const storedTranscript = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "Auto-routed answer",
        metadata: { resolvedModelId: "vllm:qwen2.5-7b-instruct", wasAutoRouted: true },
      },
    ];
    const routedModelByMessageId: Record<string, string> = {};
    const wasAutoRoutedByMessageId: Record<string, boolean> = {};
    for (const message of storedTranscript) {
      const modelId = resolvedModelIdFromMessage(message);
      if (modelId) {
        routedModelByMessageId[message.id] = modelId;
        wasAutoRoutedByMessageId[message.id] = wasAutoRoutedFromMessage(message);
      }
    }

    render(
      <ChatConversationLayout
        {...baseProps}
        selectedModel="vllm:qwen2.5-7b-instruct"
        messages={storedTranscript}
        routedModelByMessageId={routedModelByMessageId}
        wasAutoRoutedByMessageId={wasAutoRoutedByMessageId}
      />,
    );

    expect(screen.queryByText(/Answered by/i)).not.toBeInTheDocument();
  });
});

describe("ChatConversationLayout — Assist toggle doesn't reformat history (#1671)", () => {
  it("does not apply the live Assist toggle's relabeling to an older message sent under the other mode", () => {
    render(
      <ChatConversationLayout
        {...baseProps}
        adhdAssist // live toggle is now ON
        messages={[
          { id: "assistant-old", role: "assistant", content: "**Top summary**\nOlder answer." },
        ]}
        adhdAssistByMessageId={{ "assistant-old": false }} // that turn was sent with Assist OFF
      />,
    );

    // relabelAssistiveHeadings would turn this into "TLDR" if the live
    // toggle were applied instead of the per-message value.
    expect(screen.getByText(/Top summary/i)).toBeInTheDocument();
    expect(screen.queryByText(/TLDR/i)).not.toBeInTheDocument();
  });

  it("does apply relabeling to an older message that was itself sent with Assist on", () => {
    render(
      <ChatConversationLayout
        {...baseProps}
        adhdAssist={false} // live toggle is now OFF
        messages={[
          { id: "assistant-old", role: "assistant", content: "**Top summary**\nOlder answer." },
        ]}
        adhdAssistByMessageId={{ "assistant-old": true }} // that turn was sent with Assist ON
      />,
    );

    expect(screen.getByText(/TLDR/i)).toBeInTheDocument();
  });

  it("falls back to the live toggle for a legacy message with no recorded Assist metadata", () => {
    const storedTranscript: Array<{
      id: string;
      role: string;
      content: string;
      metadata?: unknown;
    }> = [
      { id: "assistant-legacy", role: "assistant", content: "**Top summary**\nLegacy answer." },
    ];
    const adhdAssistByMessageId: Record<string, boolean> = {};
    for (const message of storedTranscript) {
      const wasAssist = adhdAssistFromMessage(message);
      if (wasAssist !== undefined) adhdAssistByMessageId[message.id] = wasAssist;
    }

    render(
      <ChatConversationLayout
        {...baseProps}
        adhdAssist // live toggle is ON, and there's nothing recorded for this legacy message
        messages={storedTranscript}
        adhdAssistByMessageId={adhdAssistByMessageId}
      />,
    );

    expect(screen.getByText(/TLDR/i)).toBeInTheDocument();
  });

  it("uses streamingAdhdAssist, not the live toggle, for the in-flight message", () => {
    render(
      <ChatConversationLayout
        {...baseProps}
        adhdAssist={false} // toggled off after the in-flight request was already sent
        isLoading
        messages={[
          { id: "assistant-streaming", role: "assistant", content: "**Top summary**\nStreaming." },
        ]}
        streamingAdhdAssist // the in-flight request was sent with Assist on
      />,
    );

    expect(screen.getByText(/TLDR/i)).toBeInTheDocument();
  });
});

describe("ChatConversationLayout — in-flight progress (#1171)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a status / progress row while loading with no assistant text yet", () => {
    const { container } = render(
      <ChatConversationLayout
        {...baseProps}
        messages={[{ id: "u1", role: "user", content: "Explain recursion" }]}
        isLoading
        streamingRoutedRegistryId="vllm:qwen2.5-32b-instruct"
      />,
    );

    expect(container.querySelector("[data-chat-progress-stage]")).not.toBeNull();
    expect(screen.getAllByText(/waiting for model|routing/i).length).toBeGreaterThan(0);
  });

  it("hides status while tokens are actively streaming", () => {
    const { container } = render(
      <ChatConversationLayout
        {...baseProps}
        messages={[
          { id: "u1", role: "user", content: "Explain recursion" },
          { id: "a1", role: "assistant", content: "Recursion is" },
        ]}
        isLoading
        streamingRoutedRegistryId="google:gemini-2.5-flash"
      />,
    );

    expect(screen.getByText(/recursion is/i)).toBeInTheDocument();
    expect(container.querySelector("[data-chat-progress-stage]")).toBeNull();
  });

  it("shows Searching… when an in-progress RAG tool part is present", () => {
    const { container } = render(
      <ChatConversationLayout
        {...baseProps}
        messages={[
          { id: "u1", role: "user", content: "What did chapter 3 say?" },
          {
            id: "a1",
            role: "assistant",
            content: "",
            parts: [
              {
                type: "tool-invocation",
                toolInvocation: {
                  toolName: "getInformation",
                  state: "call",
                  toolCallId: "t1",
                  args: {},
                },
              },
            ],
          },
        ]}
        isLoading
        streamingRoutedRegistryId="vllm:qwen2.5-32b-instruct"
      />,
    );

    expect(
      container.querySelector('[data-chat-progress-stage="searching_materials"]'),
    ).not.toBeNull();
    expect(screen.getAllByText(/searching course materials/i).length).toBeGreaterThan(0);
  });

  it("shows Searching… in compact mode when text exists and a tool is active", () => {
    const { container } = render(
      <ChatConversationLayout
        {...baseProps}
        messages={[
          { id: "u1", role: "user", content: "What did chapter 3 say?" },
          {
            id: "a1",
            role: "assistant",
            content: "Looking that up",
            parts: [
              { type: "text", text: "Looking that up" },
              {
                type: "tool-invocation",
                toolInvocation: {
                  toolName: "getInformation",
                  state: "call",
                  toolCallId: "t1",
                  args: {},
                },
              },
            ],
          },
        ]}
        isLoading
        streamingRoutedRegistryId="vllm:qwen2.5-32b-instruct"
      />,
    );

    expect(
      container.querySelector(
        '[data-chat-progress-stage="searching_materials"][data-chat-progress-compact="true"]',
      ),
    ).not.toBeNull();
  });

  it("keeps compact status after a tool finishes until follow-up text arrives", () => {
    const { container, rerender } = render(
      <ChatConversationLayout
        {...baseProps}
        messages={[
          { id: "u1", role: "user", content: "What did chapter 3 say?" },
          {
            id: "a1",
            role: "assistant",
            content: "Looking that up",
            parts: [
              { type: "text", text: "Looking that up" },
              {
                type: "tool-invocation",
                toolInvocation: {
                  toolName: "getInformation",
                  state: "call",
                  toolCallId: "t1",
                  args: {},
                },
              },
            ],
          },
        ]}
        isLoading
        streamingRoutedRegistryId="vllm:qwen2.5-32b-instruct"
      />,
    );

    rerender(
      <ChatConversationLayout
        {...baseProps}
        messages={[
          { id: "u1", role: "user", content: "What did chapter 3 say?" },
          {
            id: "a1",
            role: "assistant",
            content: "Looking that up",
            parts: [
              { type: "text", text: "Looking that up" },
              {
                type: "tool-invocation",
                toolInvocation: {
                  toolName: "getInformation",
                  state: "result",
                  toolCallId: "t1",
                  args: {},
                },
              },
            ],
          },
        ]}
        isLoading
        streamingRoutedRegistryId="vllm:qwen2.5-32b-instruct"
      />,
    );

    expect(
      container.querySelector(
        '[data-chat-progress-stage="generating"][data-chat-progress-compact="true"]',
      ),
    ).not.toBeNull();
  });
});
