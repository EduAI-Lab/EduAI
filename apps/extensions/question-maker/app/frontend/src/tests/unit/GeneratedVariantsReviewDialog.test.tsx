/**
 * Unit tests for GeneratedVariantsReviewDialog (#1545): hydration of live
 * review state, approve/discard/approve-all flows, and empty-state /
 * choice-rendering branches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { questionService, toastFn } = vi.hoisted(() => {
  const toast = vi.fn() as any;
  toast.error = vi.fn();
  return {
    questionService: { getQuestion: vi.fn(), updateVariant: vi.fn(), deleteVariant: vi.fn() },
    toastFn: toast,
  };
});

vi.mock("sonner", () => ({ toast: toastFn }));
vi.mock("@/services/questionService", () => ({ questionService }));

import { GeneratedVariantsReviewDialog } from "@/components/assessments/GeneratedVariantsReviewDialog";

afterEach(cleanup);

const result = {
  results: [
    {
      questionId: 1,
      questionDescription: "A question",
      questionType: "MCQ",
      createdVariants: [
        {
          id: 100,
          difficulty: "easy",
          questionText: "What is 2+2?",
          choices: [
            { letter: "A", text: "3" },
            { letter: "B", text: "4" },
          ],
          answer: "B",
        },
        {
          id: 101,
          difficulty: "hard",
          questionText: "Explain recursion",
          answer: "A function calling itself.",
        },
      ],
    },
  ],
} as any;

const liveQuestion = {
  id: 1,
  variants: [
    { id: 100, isDraft: true },
    { id: 101, isDraft: true },
  ],
};

beforeEach(() => {
  questionService.getQuestion.mockResolvedValue(liveQuestion);
});

describe("GeneratedVariantsReviewDialog", () => {
  it("shows the empty message when there is no result", async () => {
    render(<GeneratedVariantsReviewDialog open onOpenChange={vi.fn()} result={null} />);
    await waitFor(() =>
      expect(screen.getByText("No variants were generated.")).toBeInTheDocument(),
    );
  });

  it("renders nothing when closed", () => {
    render(<GeneratedVariantsReviewDialog open={false} onOpenChange={vi.fn()} result={null} />);
    expect(screen.queryByText("Review generated variants")).not.toBeInTheDocument();
  });

  it("shows an empty message when the result has no created variants", async () => {
    render(
      <GeneratedVariantsReviewDialog
        open
        onOpenChange={vi.fn()}
        result={{ results: [{ questionId: 1, createdVariants: [] }] } as any}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("No variants were generated.")).toBeInTheDocument(),
    );
  });

  it("hydrates live status and renders variant cards with choices/answer", async () => {
    render(<GeneratedVariantsReviewDialog open onOpenChange={vi.fn()} result={result} />);
    await waitFor(() => expect(questionService.getQuestion).toHaveBeenCalledWith(1));
    expect(screen.getByText("What is 2+2?")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Explain recursion")).toBeInTheDocument();
    expect(screen.getByText("A function calling itself.")).toBeInTheDocument();
  });

  it("marks a variant as approved after live hydration says isDraft:false", async () => {
    questionService.getQuestion.mockResolvedValue({
      id: 1,
      variants: [
        { id: 100, isDraft: false },
        { id: 101, isDraft: true },
      ],
    });
    render(<GeneratedVariantsReviewDialog open onOpenChange={vi.fn()} result={result} />);
    await waitFor(() => expect(screen.getByText("Approved")).toBeInTheDocument());
  });

  it("marks a variant as discarded when it is missing from the live question", async () => {
    questionService.getQuestion.mockResolvedValue({
      id: 1,
      variants: [{ id: 101, isDraft: true }],
    });
    render(<GeneratedVariantsReviewDialog open onOpenChange={vi.fn()} result={result} />);
    await waitFor(() => expect(screen.getByText("Discarded")).toBeInTheDocument());
  });

  it("approves a variant on click", async () => {
    const onReviewed = vi.fn();
    questionService.updateVariant.mockResolvedValue(undefined);
    render(
      <GeneratedVariantsReviewDialog
        open
        onOpenChange={vi.fn()}
        result={result}
        onReviewed={onReviewed}
      />,
    );
    await waitFor(() => expect(screen.getAllByText("Approve").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText("Approve")[0]);
    await waitFor(() =>
      expect(questionService.updateVariant).toHaveBeenCalledWith(100, { isDraft: false }),
    );
    expect(onReviewed).toHaveBeenCalled();
  });

  it("discards a variant on click", async () => {
    questionService.deleteVariant.mockResolvedValue(undefined);
    render(<GeneratedVariantsReviewDialog open onOpenChange={vi.fn()} result={result} />);
    await waitFor(() => expect(screen.getAllByText("Discard").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText("Discard")[0]);
    await waitFor(() => expect(questionService.deleteVariant).toHaveBeenCalledWith(100));
  });

  it("treats a 409 VARIANT_LOCKED approve error as already-approved", async () => {
    questionService.updateVariant.mockRejectedValue({
      response: { status: 409, data: { error: "VARIANT_LOCKED" } },
    });
    render(<GeneratedVariantsReviewDialog open onOpenChange={vi.fn()} result={result} />);
    await waitFor(() => expect(screen.getAllByText("Approve").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText("Approve")[0]);
    await waitFor(() => expect(screen.getByText("Approved")).toBeInTheDocument());
    expect(toastFn.error).not.toHaveBeenCalled();
  });

  it("shows an error toast when approve fails for another reason", async () => {
    questionService.updateVariant.mockRejectedValue({ response: { status: 500 } });
    render(<GeneratedVariantsReviewDialog open onOpenChange={vi.fn()} result={result} />);
    await waitFor(() => expect(screen.getAllByText("Approve").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText("Approve")[0]);
    await waitFor(() => expect(toastFn.error).toHaveBeenCalled());
  });

  it("shows an error toast when discard fails", async () => {
    questionService.deleteVariant.mockRejectedValue({ response: { data: { error: "nope" } } });
    render(<GeneratedVariantsReviewDialog open onOpenChange={vi.fn()} result={result} />);
    await waitFor(() => expect(screen.getAllByText("Discard").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText("Discard")[0]);
    await waitFor(() => expect(toastFn.error).toHaveBeenCalled());
  });

  it("approves all pending variants sequentially", async () => {
    questionService.updateVariant.mockResolvedValue(undefined);
    render(<GeneratedVariantsReviewDialog open onOpenChange={vi.fn()} result={result} />);
    await waitFor(() => expect(screen.getByText(/Approve all/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Approve all/));
    await waitFor(() => expect(questionService.updateVariant).toHaveBeenCalledTimes(2));
  });

  it("calls onOpenChange(false) from the Done button", async () => {
    const onOpenChange = vi.fn();
    render(<GeneratedVariantsReviewDialog open onOpenChange={onOpenChange} result={result} />);
    await waitFor(() => expect(screen.getByText("Done")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Done"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
