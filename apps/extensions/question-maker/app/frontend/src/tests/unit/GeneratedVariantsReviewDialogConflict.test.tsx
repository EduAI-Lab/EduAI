/**
 * @vitest-environment jsdom
 *
 * A 409 from approve used to mean exactly one thing — "already reviewed" — so
 * the dialog treated any 409 as an idempotent approve-success. It no longer
 * does: a lost publish race answers VARIANT_CONFLICT with the same status
 * *after* withdrawing the Core row it had just pushed, so the variant is
 * demonstrably not published. Reporting that as approved told the instructor
 * the opposite of what happened (#1652 review).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GeneratedVariantsReviewDialog } from "../../components/assessments/GeneratedVariantsReviewDialog";

const updateVariant = vi.fn();
const getQuestion = vi.fn();
const toastError = vi.fn();

vi.mock("../../services/questionService", () => ({
  questionService: {
    updateVariant: (...args: unknown[]) => updateVariant(...args),
    getQuestion: (...args: unknown[]) => getQuestion(...args),
    deleteVariant: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: (...args: unknown[]) => toastError(...args) }),
}));

const RESULT = {
  results: [
    {
      questionId: 7,
      questionDescription: "Big-O",
      questionType: "MCQ",
      createdVariants: [
        {
          id: 11,
          questionText: "What does Big-O measure?",
          difficulty: "medium",
          reasoningLevel: "factual",
          answer: "A",
          choices: [
            { letter: "A", text: "Growth" },
            { letter: "B", text: "Speed" },
          ],
        },
      ],
    },
  ],
};

function renderDialog() {
  return render(
    <GeneratedVariantsReviewDialog
      open
      onOpenChange={() => {}}
      result={RESULT as never}
      onReviewed={() => {}}
    />,
  );
}

/** Rejects the way axios does, with a status and a machine code. */
function apiError(status: number, code: string, error: string) {
  return Object.assign(new Error(error), { response: { status, data: { code, error } } });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Live state: still a draft, so the card renders with its Approve button.
  getQuestion.mockResolvedValue({ id: 7, variants: [{ id: 11, isDraft: true }] });
});

afterEach(cleanup);

describe("approving a generated variant", () => {
  it("keeps a lost publish race pending and says so, instead of showing it approved", async () => {
    updateVariant.mockRejectedValue(
      apiError(409, "VARIANT_CONFLICT", "Someone else changed this question at the same time."),
    );

    renderDialog();
    const approve = await screen.findByRole("button", { name: "Approve" });
    await waitFor(() => expect(approve).toBeEnabled());
    fireEvent.click(approve);

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.queryByText(/^Approved$/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("still treats the already-reviewed lock as an idempotent success", async () => {
    updateVariant.mockRejectedValue(
      apiError(409, "VARIANT_LOCKED", "This question is reviewed, so its content is locked."),
    );

    renderDialog();
    const approve = await screen.findByRole("button", { name: "Approve" });
    await waitFor(() => expect(approve).toBeEnabled());
    fireEvent.click(approve);

    expect(await screen.findByText(/^Approved$/)).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
  });
});
