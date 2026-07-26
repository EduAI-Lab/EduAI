import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ChatConversationLayout } from "~/components/chat/chat-conversation-layout";
import {
  resolvedModelIdFromMessage,
  wasAutoRoutedFromMessage,
} from "~/lib/chat/chat-message-metadata";
import { CHAT_PROGRESS_TEXT_IDLE_MS } from "~/components/chat/chat-progress-stage";

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
        messages={[
          { id: "assistant-1", role: "assistant", content: "Persisted answer" },
        ]}
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
        messages={[
          { id: "assistant-stream", role: "assistant", content: "Streaming" },
        ]}
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
        messages={[
          { id: "assistant-1", role: "assistant", content: "Auto-routed answer" },
        ]}
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
        messages={[
          { id: "assistant-1", role: "assistant", content: "Explicit answer" },
        ]}
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

describe("ChatConversationLayout — in-flight progress (#1171)", () => {
  it("shows a status / progress row while loading with no assistant text yet", () => {
    const { container } = render(
      <ChatConversationLayout
        {...baseProps}
        messages={[{ id: "u1", role: "user", content: "Explain recursion" }]}
        isLoading
        streamingRoutedRegistryId="vllm:qwen2.5-32b-instruct"
      />,
    );

    expect(
      container.querySelector("[data-chat-progress-stage]"),
    ).not.toBeNull();
    expect(screen.getAllByText(/waiting for model|routing/i).length).toBeGreaterThan(
      0,
    );
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

  it("re-shows a compact status row after streamed text goes idle", () => {
    vi.useFakeTimers();
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

    act(() => {
      vi.advanceTimersByTime(CHAT_PROGRESS_TEXT_IDLE_MS + 250);
    });

    expect(
      container.querySelector('[data-chat-progress-compact="true"]'),
    ).not.toBeNull();
    expect(screen.getAllByText(/generating/i).length).toBeGreaterThan(0);
    vi.useRealTimers();
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
      container.querySelector(
        '[data-chat-progress-stage="searching_materials"]',
      ),
    ).not.toBeNull();
    expect(
      screen.getAllByText(/searching course materials/i).length,
    ).toBeGreaterThan(0);
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
});
