import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatConversationLayout } from "~/components/chat/chat-conversation-layout";

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

  it("uses the response-header fallback for an in-flight assistant message", () => {
    render(
      <ChatConversationLayout
        {...baseProps}
        selectedModel="auto"
        messages={[
          { id: "assistant-stream", role: "assistant", content: "Streaming" },
        ]}
        isLoading
        streamingRoutedRegistryId="vllm:qwen2.5-7b-instruct"
      />,
    );

    expect(
      screen.getByText("Answered by vllm:qwen2.5-7b-instruct"),
    ).toBeInTheDocument();
  });
});
