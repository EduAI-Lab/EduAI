/**
 * QuestionModal is a thin routing wrapper around AddQuestionDialog (#1545) — it
 * just forwards all props through. Mock the child so this stays a unit test of
 * the wrapper, not a re-test of AddQuestionDialog's internals.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const AddQuestionDialogMock = vi.fn((props: Record<string, unknown>) => (
  <div data-testid="add-question-dialog-mock">{String(props.mode)}</div>
));

vi.mock("@/components/questions/AddQuestionDialog", () => ({
  AddQuestionDialog: (props: Record<string, unknown>) => AddQuestionDialogMock(props),
}));

const { QuestionModal } = await import("@/components/questions/QuestionModal");

describe("QuestionModal", () => {
  it("forwards all props through to AddQuestionDialog", () => {
    cleanup();
    AddQuestionDialogMock.mockClear();
    const onClose = vi.fn();

    const onQuestionCreated = vi.fn();
    render(
      <QuestionModal
        mode="create"
        open
        onClose={onClose}
        courseId={7}
        variants={[]}
        onQuestionCreated={onQuestionCreated}
      />,
    );

    expect(screen.getByTestId("add-question-dialog-mock")).toHaveTextContent("create");
    expect(AddQuestionDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "create", onClose, courseId: 7, onQuestionCreated }),
    );
  });
});
