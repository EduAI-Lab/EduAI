import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

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
  webToolsEnabled: false,
  onInputChange: () => {},
  onSubmit: () => {},
  onSelectPrompt: () => {},
};

describe("Chat views — role layouts", () => {
  it("course-scoped view shows course selector pill", () => {
    render(<ChatCourseScopedView {...baseProps} />);
    // Course-scoped view shows a course selector pill that says "Select course"
    expect(screen.getByText("Course")).toBeInTheDocument();
  });
});
