/**
 * #1762 — target-bank picker for moving a question out of the bank in view, or
 * adding it to another bank. Service calls are mocked; the dialog UI renders for real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { moveQuestionToBank, addQuestionToBank, listBankIdsForQuestion } = vi.hoisted(() => ({
  moveQuestionToBank: vi.fn(),
  addQuestionToBank: vi.fn(),
  listBankIdsForQuestion: vi.fn(),
}));

vi.mock("@/services/questionBankService", () => ({
  questionBankService: { moveQuestionToBank, addQuestionToBank, listBankIdsForQuestion },
}));

import { MoveQuestionToBankDialog } from "@/components/question-bank/MoveQuestionToBankDialog";

beforeEach(() => {
  listBankIdsForQuestion.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const BANKS = [
  { id: "b1", courseId: 5, name: "Course bank", isDefault: true },
  { id: "b2", courseId: 5, name: "Midterm", isDefault: false },
];

function renderDialog(overrides: Partial<Parameters<typeof MoveQuestionToBankDialog>[0]> = {}) {
  const onOpenChange = vi.fn();
  const onSuccess = vi.fn();
  render(
    <MoveQuestionToBankDialog
      open
      onOpenChange={onOpenChange}
      mode="move"
      courseId={5}
      questionId={42}
      banks={BANKS}
      currentBankId="b1"
      onSuccess={onSuccess}
      {...overrides}
    />,
  );
  return { onOpenChange, onSuccess };
}

function pickTarget(name: string) {
  fireEvent.click(screen.getByLabelText("Target bank"));
  fireEvent.click(screen.getByRole("option", { name }));
}

describe("MoveQuestionToBankDialog", () => {
  it("explains the whole-question scope and excludes the current bank when moving", () => {
    renderDialog();

    expect(screen.getByText("Moves question #42 and all its variants.")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Target bank"));
    expect(screen.getByRole("option", { name: "Midterm" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Course bank (default)" })).not.toBeInTheDocument();
  });

  it("shows an empty state when there is no other bank", () => {
    renderDialog({ banks: [BANKS[0]] });

    expect(screen.getByText("Create a bank on the Banks tab first.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move" })).toBeDisabled();
  });

  it("keeps confirm disabled until a target is chosen", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Move" })).toBeDisabled();
    pickTarget("Midterm");
    expect(screen.getByRole("button", { name: "Move" })).toBeEnabled();
  });

  it("moves the question, reports the target bank and closes", async () => {
    moveQuestionToBank.mockResolvedValue(undefined);
    const { onOpenChange, onSuccess } = renderDialog();

    pickTarget("Midterm");
    fireEvent.click(screen.getByRole("button", { name: "Move" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(BANKS[1]));
    expect(moveQuestionToBank).toHaveBeenCalledWith(5, "b1", 42, "b2");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("adds the question to the chosen bank in add mode", async () => {
    addQuestionToBank.mockResolvedValue(undefined);
    const { onSuccess } = renderDialog({ mode: "add", currentBankId: null });

    pickTarget("Course bank (default)");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(BANKS[0]));
    expect(addQuestionToBank).toHaveBeenCalledWith(5, "b1", 42);
    expect(moveQuestionToBank).not.toHaveBeenCalled();
  });

  it("offers a bank the question is already in as an unselectable target", async () => {
    listBankIdsForQuestion.mockResolvedValue(["b2"]);
    renderDialog();

    await waitFor(() => expect(listBankIdsForQuestion).toHaveBeenCalledWith(5, 42));
    fireEvent.click(screen.getByLabelText("Target bank"));

    const option = await screen.findByRole("option", {
      name: "Midterm — already in this bank",
    });
    expect(option).toHaveAttribute("aria-disabled", "true");
  });

  it("does not move a question into a bank that already holds it", async () => {
    listBankIdsForQuestion.mockResolvedValue(["b2"]);
    renderDialog();

    await waitFor(() => expect(listBankIdsForQuestion).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText("Target bank"));
    fireEvent.click(screen.getByRole("option", { name: "Midterm — already in this bank" }));

    // The open select portal aria-hides the footer, so reach the button through it.
    expect(screen.getByRole("button", { name: "Move", hidden: true })).toBeDisabled();
    expect(screen.getByLabelText("Target bank")).toHaveTextContent("Choose a bank");
    expect(moveQuestionToBank).not.toHaveBeenCalled();
  });

  it("says so when every other bank already holds the question", async () => {
    listBankIdsForQuestion.mockResolvedValue(["b2"]);
    renderDialog();

    expect(
      await screen.findByText("This question is already in every other bank."),
    ).toBeInTheDocument();
  });

  it("falls back to every bank being selectable when the lookup fails", async () => {
    listBankIdsForQuestion.mockRejectedValue(new Error("offline"));
    moveQuestionToBank.mockResolvedValue(undefined);
    const { onSuccess } = renderDialog();

    await waitFor(() => expect(listBankIdsForQuestion).toHaveBeenCalled());
    pickTarget("Midterm");
    fireEvent.click(screen.getByRole("button", { name: "Move" }));

    // The server-side guard is the backstop when the picker can't pre-filter.
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(BANKS[1]));
  });

  it("shows the server error inline and stays open", async () => {
    moveQuestionToBank.mockRejectedValue(
      Object.assign(new Error("Request failed with status code 404"), {
        isAxiosError: true,
        response: { data: { error: "Question is not a member of this bank" } },
      }),
    );
    const { onOpenChange, onSuccess } = renderDialog();

    pickTarget("Midterm");
    fireEvent.click(screen.getByRole("button", { name: "Move" }));

    expect(await screen.findByText("Question is not a member of this bank")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
