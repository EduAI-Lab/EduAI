/**
 * Unit tests for AddQuestionsToBankDialog (#1541 close-out): load/error states,
 * search filtering, already-in-bank exclusion, selection toggling, and the
 * add-questions submit flow (partial success and all-failed paths).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { questionService, questionBankService, toastFn } = vi.hoisted(() => {
  const toast = vi.fn() as any;
  toast.error = vi.fn();
  return {
    questionService: { getQuestionsPage: vi.fn() },
    questionBankService: { addQuestionToBank: vi.fn() },
    toastFn: toast,
  };
});

vi.mock("sonner", () => ({ toast: toastFn }));
vi.mock("@/services/questionService", () => ({ questionService }));
vi.mock("@/services/questionBankService", () => ({ questionBankService }));

import { AddQuestionsToBankDialog } from "@/components/question-bank/AddQuestionsToBankDialog";

function makeQuestion(id: number, text: string) {
  return {
    id,
    type: "MCQ",
    description: null,
    variants: [{ questionText: text }],
  } as any;
}

describe("AddQuestionsToBankDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads course questions, excludes bank members, and adds a selection", async () => {
    questionService.getQuestionsPage
      .mockResolvedValueOnce({
        items: [makeQuestion(1, "What is 2+2?"), makeQuestion(2, "Capital of France")],
      })
      .mockResolvedValueOnce({ items: [makeQuestion(2, "Capital of France")] });
    questionBankService.addQuestionToBank.mockResolvedValue(undefined);

    const onAdded = vi.fn();
    const onClose = vi.fn();
    render(
      <AddQuestionsToBankDialog
        open
        onClose={onClose}
        courseId={7}
        bankId="bank-1"
        bankName="Midterm Bank"
        onAdded={onAdded}
      />,
    );

    expect(await screen.findByTestId("add-to-bank-question-list")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(screen.getByText("In Bank")).toBeInTheDocument();

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[1]).toBeDisabled();

    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByTestId("add-to-bank-confirm"));

    await waitFor(() =>
      expect(questionBankService.addQuestionToBank).toHaveBeenCalledWith(7, "bank-1", 1),
    );
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(1));
    expect(onClose).toHaveBeenCalled();
    expect(toastFn).toHaveBeenCalledWith("Questions added", expect.objectContaining({}));
  });

  it("filters the list by search text", async () => {
    questionService.getQuestionsPage
      .mockResolvedValueOnce({
        items: [makeQuestion(1, "What is 2+2?"), makeQuestion(2, "Capital of France")],
      })
      .mockResolvedValueOnce({ items: [] });

    render(<AddQuestionsToBankDialog open onClose={vi.fn()} courseId={7} bankId="bank-1" />);

    await screen.findByTestId("add-to-bank-question-list");
    fireEvent.change(screen.getByLabelText("Search questions"), { target: { value: "france" } });

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText(/Capital of France/)).toBeInTheDocument();
  });

  it("shows an empty state when no questions match", async () => {
    questionService.getQuestionsPage
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] });

    render(<AddQuestionsToBankDialog open onClose={vi.fn()} courseId={7} bankId="bank-1" />);

    expect(await screen.findByText("No questions found.")).toBeInTheDocument();
  });

  it("surfaces a load error", async () => {
    questionService.getQuestionsPage.mockRejectedValue(new Error("network down"));

    render(<AddQuestionsToBankDialog open onClose={vi.fn()} courseId={7} bankId="bank-1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("network down");
  });

  it("reports failure when every add call rejects", async () => {
    questionService.getQuestionsPage
      .mockResolvedValueOnce({ items: [makeQuestion(1, "Q1")] })
      .mockResolvedValueOnce({ items: [] });
    questionBankService.addQuestionToBank.mockRejectedValue(new Error("boom"));

    const onClose = vi.fn();
    render(<AddQuestionsToBankDialog open onClose={onClose} courseId={7} bankId="bank-1" />);

    await screen.findByTestId("add-to-bank-question-list");
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByTestId("add-to-bank-confirm"));

    await waitFor(() =>
      expect(toastFn.error).toHaveBeenCalledWith(
        "Could not add questions",
        expect.objectContaining({}),
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not fetch when courseId or bankId is missing", () => {
    render(<AddQuestionsToBankDialog open onClose={vi.fn()} courseId={null} bankId={null} />);
    expect(questionService.getQuestionsPage).not.toHaveBeenCalled();
  });

  it("closes via onOpenChange when dismissed", async () => {
    questionService.getQuestionsPage
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] });
    const onClose = vi.fn();
    render(<AddQuestionsToBankDialog open onClose={onClose} courseId={7} bankId="bank-1" />);
    await screen.findByText("No questions found.");

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
