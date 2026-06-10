import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ChatGlobalView } from "~/components/chat/chat-global-view";
import { ChatCourseScopedView } from "~/components/chat/chat-course-scoped-view";

const baseProps = {
  chatModels: [],
  selectedModel: "",
  setSelectedModel: () => {},
  selectedCourseCode: null,
  setSelectedCourseCode: () => {},
  availableCourses: [],
  messages: [],
  input: "",
  isLoading: false,
  adhdAssist: false,
  assistive: false,
  onAssistiveChange: () => {},
  focusMode: false,
  onFocusModeChange: () => {},
  systemPrompt: null,
  onSystemPromptSave: async () => {},
  onInputChange: () => {},
  onSubmit: () => {},
  onSelectPrompt: () => {},
};

describe("Chat views — role layouts", () => {
  it("global view hides course selector banner text", () => {
    render(<ChatGlobalView {...baseProps} />);
    expect(screen.getByText("Global chat")).toBeInTheDocument();
  });

  it("course-scoped view shows course banner", () => {
    render(<ChatCourseScopedView {...baseProps} />);
    expect(screen.getByText("Course-scoped chat")).toBeInTheDocument();
  });
});

describe("Chat views — assistive mode toggle", () => {
  it("calls onAssistiveChange when the assistive mode switch is clicked", () => {
    const onAssistiveChange = vi.fn();
    render(<ChatGlobalView {...baseProps} onAssistiveChange={onAssistiveChange} />);
    fireEvent.click(screen.getByRole("switch", { name: /assistive mode/i }));
    expect(onAssistiveChange).toHaveBeenCalledWith(true);
  });
});
