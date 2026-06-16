import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

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
  onAssistChange: () => {},
  systemPrompt: null,
  onSystemPromptSave: async () => {},
  onInputChange: () => {},
  onSubmit: () => {},
  onSelectPrompt: () => {},
  webToolsEnabled: false,
};

describe("Chat views — role layouts", () => {
  it("global view shows Global indicator pill", () => {
    render(<ChatGlobalView {...baseProps} />);
    // Global view shows a "Global" indicator pill in the input area
    expect(screen.getByText("Global")).toBeInTheDocument();
  });

  it("course-scoped view shows course selector pill", () => {
    render(<ChatCourseScopedView {...baseProps} />);
    // Course-scoped view shows a course selector pill that says "Select course"
    expect(screen.getByText("Select course")).toBeInTheDocument();
  });
});
