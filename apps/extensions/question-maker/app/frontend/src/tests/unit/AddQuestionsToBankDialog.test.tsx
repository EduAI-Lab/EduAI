/**
 * Unit tests for AddQuestionsToBankDialog (#1541 close-out): load/error states,
 * search filtering, already-in-bank exclusion, selection toggling, and the
 * add-questions submit flow (partial success and all-failed paths), and a
 * question that is already in the bank (Core 409) counted apart from failures.
 */
import { AxiosError } from "axios";
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

function alreadyInBankError() {
  return new AxiosError("Request failed with status code 409", "ERR_BAD_REQUEST", undefined, null, {
    status: 409,
    data: { error: "Question is already in this bank" },
  } as any);
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

  // #1778 review: Core answers a duplicate add with 409. A question added from
  // another tab since the dialog loaded is already where the user wants it, so
  // it must not read as a failure ("Check Core linkage").
  it("counts a question already in the bank apart from failures", async () => {
    questionService.getQuestionsPage
      .mockResolvedValueOnce({ items: [makeQuestion(1, "Q1"), makeQuestion(2, "Q2")] })
      .mockResolvedValueOnce({ items: [] });
    questionBankService.addQuestionToBank
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(alreadyInBankError());

    const onAdded = vi.fn();
    render(
      <AddQuestionsToBankDialog
        open
        onClose={vi.fn()}
        courseId={7}
        bankId="bank-1"
        bankName="Midterm Bank"
        onAdded={onAdded}
      />,
    );

    await screen.findByTestId("add-to-bank-question-list");
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByTestId("add-to-bank-confirm"));

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(1));
    expect(toastFn).toHaveBeenCalledWith("Questions added", {
      description: "1 question added to Midterm Bank (1 already in the bank).",
    });
    expect(toastFn.error).not.toHaveBeenCalled();
  });

  it("says so, rather than reporting a failure, when every selection is already in the bank", async () => {
    questionService.getQuestionsPage
      .mockResolvedValueOnce({ items: [makeQuestion(1, "Q1")] })
      .mockResolvedValueOnce({ items: [] });
    questionBankService.addQuestionToBank.mockRejectedValue(alreadyInBankError());

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

    await screen.findByTestId("add-to-bank-question-list");
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByTestId("add-to-bank-confirm"));

    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith("Already in bank", {
        description: "That question is already in Midterm Bank.",
      }),
    );
    expect(toastFn.error).not.toHaveBeenCalled();
    // Refresh so the list shows the membership the user didn't know about.
    expect(onAdded).toHaveBeenCalledWith(0);
    expect(onClose).toHaveBeenCalled();
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
