/**
 * Unit tests for AssessmentBuilder (#1545): empty state, readOnly gating,
 * and the add-questions picker flow (open, exclude ids, confirm). Reorder
 * behavior is already covered by AssessmentBuilderReorder.test.tsx.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AssessmentBuilder } from "@/components/assessments/AssessmentBuilder";
import type { Assessment } from "@/types/question";

afterEach(cleanup);

const emptyAssessment = { id: 1, sections: [] } as unknown as Assessment;

const assessmentWithSection = {
  id: 1,
  sections: [{ id: 10, name: "Section A", position: 0, sectionVariants: [{ variantId: 100 }] }],
} as unknown as Assessment;

const questionBank = [
  {
    questionId: 1,
    variant: { id: 100, questionText: "Existing Q" },
    questionType: "MCQ",
    primaryTopicId: "t1",
  },
  {
    questionId: 2,
    variant: { id: 200, questionText: "New Q" },
    questionType: "MCQ",
    primaryTopicId: "t1",
  },
] as any;

function baseProps(overrides: any = {}) {
  return {
    assessment: emptyAssessment,
    questionBank,
    topics: [],
    onAddSection: vi.fn(),
    onUpdateSectionName: vi.fn(),
    onDeleteSection: vi.fn(),
    onAddQuestionsToSection: vi.fn(),
    onRemoveQuestionFromSection: vi.fn(),
    ...overrides,
  };
}

describe("AssessmentBuilder", () => {
  it("shows an empty state with an add-first-section button", () => {
    const onAddSection = vi.fn();
    render(<AssessmentBuilder {...baseProps({ onAddSection })} />);
    expect(screen.getByText("No sections yet")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Add first section"));
    expect(onAddSection).toHaveBeenCalled();
  });

  it("calls onAddSection from the header button", () => {
    const onAddSection = vi.fn();
    render(<AssessmentBuilder {...baseProps({ onAddSection })} />);
    fireEvent.click(screen.getByText("Add section"));
    expect(onAddSection).toHaveBeenCalled();
  });

  it("hides add-section controls when readOnly", () => {
    render(<AssessmentBuilder {...baseProps({ readOnly: true })} />);
    expect(screen.queryByText("Add section")).not.toBeInTheDocument();
    expect(screen.queryByText("Add first section")).not.toBeInTheDocument();
  });

  it("shows the section count", () => {
    render(<AssessmentBuilder {...baseProps({ assessment: assessmentWithSection })} />);
    expect(screen.getByText("Sections (1)")).toBeInTheDocument();
  });

  it("opens the question picker excluding variants already in the section and adds a question", async () => {
    const onAddQuestionsToSection = vi.fn();
    render(
      <AssessmentBuilder
        {...baseProps({ assessment: assessmentWithSection, onAddQuestionsToSection })}
      />,
    );
    fireEvent.click(screen.getByText("Add more questions"));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText("New Q")).toBeInTheDocument());
    expect(within(dialog).queryByText("Existing Q")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByText("New Q"));
    fireEvent.click(within(dialog).getByText(/Add 1 question/));
    expect(onAddQuestionsToSection).toHaveBeenCalledWith(10, [200]);
  });

  it("resets the picker's section id when the picker is closed without confirming", async () => {
    render(<AssessmentBuilder {...baseProps({ assessment: assessmentWithSection })} />);
    fireEvent.click(screen.getByText("Add more questions"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("renames a section on title blur", () => {
    const onUpdateSectionName = vi.fn();
    render(
      <AssessmentBuilder
        {...baseProps({ assessment: assessmentWithSection, onUpdateSectionName })}
      />,
    );
    const titleInput = screen.getByDisplayValue("Section A");
    fireEvent.change(titleInput, { target: { value: "Renamed Section" } });
    fireEvent.blur(titleInput);
    expect(onUpdateSectionName).toHaveBeenCalledWith(10, "Renamed Section");
  });

  it("deletes a section from its header button", () => {
    const onDeleteSection = vi.fn();
    render(
      <AssessmentBuilder {...baseProps({ assessment: assessmentWithSection, onDeleteSection })} />,
    );
    fireEvent.click(screen.getByLabelText("Delete section"));
    expect(onDeleteSection).toHaveBeenCalledWith(10);
  });

  it("reorders sections via the move-up control", async () => {
    const onReorderSections = vi.fn().mockResolvedValue(undefined);
    const twoSections = {
      id: 1,
      sections: [
        { id: 10, name: "Section A", position: 0, sectionVariants: [] },
        { id: 11, name: "Section B", position: 1, sectionVariants: [] },
      ],
    } as unknown as Assessment;
    render(<AssessmentBuilder {...baseProps({ assessment: twoSections, onReorderSections })} />);
    const moveUpButtons = screen.getAllByLabelText("Move section up");
    fireEvent.click(moveUpButtons[1]);
    await waitFor(() => expect(onReorderSections).toHaveBeenCalledWith([11, 10]));
  });
});
