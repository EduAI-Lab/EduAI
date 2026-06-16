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

describe("Chat views — header controls placement", () => {
  it("does not render system prompt controls in the scrollable chat body", () => {
    render(<ChatGlobalView {...baseProps} />);
    expect(screen.queryByRole("button", { name: /system prompt/i })).not.toBeInTheDocument();
  });

  it("renders the assistive mode switch near the chat input", () => {
    render(<ChatGlobalView {...baseProps} />);
    expect(screen.getByRole("switch", { name: /assistive mode/i })).toBeInTheDocument();
  });
});
