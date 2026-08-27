/**
 * Unit tests for AssessmentQuestionPicker (#1545): search/type/difficulty
 * filtering, select-all/clear-selection, empty-state variants, and the
 * confirm/cancel/close flows.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AssessmentQuestionPicker } from "@/components/assessments/AssessmentQuestionPicker";

afterEach(cleanup);

const topics = [{ id: "t1", name: "Topic One" }] as any;

const entry = (id: number, overrides: any = {}) => ({
  questionId: id,
  questionDescription: `Description ${id}`,
  questionType: "MCQ",
  primaryTopicId: "t1",
  primaryTopicName: "Topic One",
  variant: { id, questionText: `Question text ${id}`, difficulty: "easy" },
  ...overrides,
});

function renderPicker(props: Partial<React.ComponentProps<typeof AssessmentQuestionPicker>> = {}) {
  return render(
    <AssessmentQuestionPicker
      open
      onOpenChange={vi.fn()}
      questionBank={[
        entry(1),
        entry(2, { variant: { id: 2, questionText: "Recursion basics", difficulty: "hard" } }),
      ]}
      excludeVariantIds={[]}
      topics={topics}
      onConfirm={vi.fn()}
      {...props}
    />,
  );
}

describe("AssessmentQuestionPicker", () => {
  it("renders available questions excluding already-added variants", () => {
    renderPicker({ excludeVariantIds: [2] });
    expect(screen.getByText("Question text 1")).toBeInTheDocument();
    expect(screen.queryByText("Recursion basics")).not.toBeInTheDocument();
    expect(screen.getByText("1 available question in this course")).toBeInTheDocument();
  });

  it("filters by search text", () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText("Search questions"), {
      target: { value: "recursion" },
    });
    expect(screen.getByText("Recursion basics")).toBeInTheDocument();
    expect(screen.queryByText("Question text 1")).not.toBeInTheDocument();
  });

  it("filters by question type", () => {
    renderPicker({
      questionBank: [
        entry(1),
        entry(2, {
          questionType: "SA",
          variant: { id: 2, questionText: "SA question", difficulty: "medium" },
        }),
      ],
    });
    fireEvent.click(screen.getByText("Short answer"));
    expect(screen.getByText("SA question")).toBeInTheDocument();
    expect(screen.queryByText("Question text 1")).not.toBeInTheDocument();
  });

  it("filters by difficulty", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "hard" }));
    expect(screen.getByText("Recursion basics")).toBeInTheDocument();
    expect(screen.queryByText("Question text 1")).not.toBeInTheDocument();
  });

  it("toggles a type filter off when clicked again", () => {
    renderPicker({
      questionBank: [
        entry(1),
        entry(2, {
          questionType: "SA",
          variant: { id: 2, questionText: "SA question", difficulty: "medium" },
        }),
      ],
    });
    fireEvent.click(screen.getByText("Short answer"));
    fireEvent.click(screen.getByText("Short answer"));
    expect(screen.getByText("Question text 1")).toBeInTheDocument();
    expect(screen.getByText("SA question")).toBeInTheDocument();
  });

  it("toggles a difficulty filter off when clicked again", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "hard" }));
    fireEvent.click(screen.getByRole("button", { name: "hard" }));
    expect(screen.getByText("Question text 1")).toBeInTheDocument();
    expect(screen.getByText("Recursion basics")).toBeInTheDocument();
  });

  it("shows a Clear button when filters are active and clears them", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "hard" }));
    expect(screen.getByText("Clear")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Clear"));
    expect(screen.getByText("Question text 1")).toBeInTheDocument();
  });

  it("toggles a question selection and updates the count", () => {
    renderPicker();
    fireEvent.click(screen.getByText("Question text 1"));
    expect(screen.getByText("· 1 selected")).toBeInTheDocument();
    expect(screen.getByText("1 question selected")).toBeInTheDocument();
  });

  it("selects and clears all filtered questions", () => {
    renderPicker();
    fireEvent.click(screen.getByText("Select all"));
    expect(screen.getByText("2 questions selected")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Clear selection"));
    expect(screen.getByText("0 questions selected")).toBeInTheDocument();
  });

  it("disables the Add button when nothing is selected and enables it once selected", () => {
    renderPicker();
    const addBtn = screen.getByText(/Add\s+questions?/).closest("button")!;
    expect(addBtn).toBeDisabled();
    fireEvent.click(screen.getByText("Question text 1"));
    expect(addBtn).not.toBeDisabled();
  });

  it("confirms with selected variant ids and resets selection", () => {
    const onConfirm = vi.fn();
    renderPicker({ onConfirm });
    fireEvent.click(screen.getByText("Question text 1"));
    fireEvent.click(screen.getByText(/Add 1 question/));
    expect(onConfirm).toHaveBeenCalledWith([1]);
  });

  it("cancels and closes without confirming", () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    renderPicker({ onOpenChange, onConfirm });
    fireEvent.click(screen.getByText("Cancel"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows a no-questions-in-course message when the bank is empty", () => {
    renderPicker({ questionBank: [] });
    expect(screen.getByText("No questions to add")).toBeInTheDocument();
  });

  it("shows a no-more-questions message when everything is excluded", () => {
    renderPicker({ excludeVariantIds: [1, 2] });
    expect(screen.getByText("No more questions")).toBeInTheDocument();
  });

  it("shows a no-match message and clear-filters action when filters exclude everything", () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText("Search questions"), {
      target: { value: "zzzznomatch" },
    });
    expect(screen.getByText("No questions match")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Clear filters"));
    expect(screen.getByText("Question text 1")).toBeInTheDocument();
  });
});
