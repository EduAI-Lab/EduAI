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
