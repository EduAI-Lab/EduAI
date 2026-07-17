import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
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

  it("fills the shell pane instead of re-calculating 100vh (no scroll past composer)", () => {
    const { container } = render(<ChatConversationLayout {...baseProps} />);
    const root = container.firstElementChild as HTMLElement | null;
    expect(root?.className).toMatch(/\bh-full\b/);
    expect(root?.className).toMatch(/\bmin-h-0\b/);
    expect(root?.className).not.toMatch(/100vh/);
  });
});
