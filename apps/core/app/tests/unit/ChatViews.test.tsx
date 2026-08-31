import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ChatCourseScopedView } from "~/components/chat/chat-course-scoped-view";

const baseProps = {
  chatModels: [],
  selectedModel: "",
  setSelectedModel: () => {},
  selectedCourseId: null,
  selectedCourseCode: null,
  setSelectedCourseId: () => {},
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

  it("emits the selected course id to the chat handler", () => {
    const setSelectedCourseId = vi.fn();

    render(
      <ChatCourseScopedView
        {...baseProps}
        setSelectedCourseId={setSelectedCourseId}
        availableCourses={[{ id: "c1", code: "COSC 101", name: "Intro to CS" }]}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Course" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /COSC 101/ }));

    expect(setSelectedCourseId).toHaveBeenCalledWith("c1");
  });
});
