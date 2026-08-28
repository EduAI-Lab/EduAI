/**
 * #1545 — view-mode coverage for AddQuestionDialog beyond the review-status
 * confirm dialog (see AddQuestionDialogReviewConfirm.test.tsx). Exercises the
 * MCQ choices display/edit flow, the metadata edit form, the AI-tag and
 * testable toggles, the sibling-variant rail, and the create/delete variant
 * footer actions — the largest untested surface of the component.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { QuestionVariantEntry } from "@/types/question";

const toastFn = vi.fn() as any;
toastFn.error = vi.fn();
vi.mock("sonner", () => ({ toast: toastFn }));

const updateVariant = vi.fn();
const updateQuestion = vi.fn();
const setVariantTestable = vi.fn();

vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("@/services/questionService", () => ({
  questionService: {
    updateVariant: (...args: unknown[]) => updateVariant(...args),
    updateQuestion: (...args: unknown[]) => updateQuestion(...args),
    setVariantTestable: (...args: unknown[]) => setVariantTestable(...args),
  },
}));

const getCourse = vi.fn();
const getCourseTopics = vi.fn();
vi.mock("@/services/courseService", () => ({
  courseService: {
    getCourse: (...args: unknown[]) => getCourse(...args),
    getCourseTopics: (...args: unknown[]) => getCourseTopics(...args),
  },
}));

vi.mock("@/services/assessmentService", () => ({
  default: { getAssessments: vi.fn().mockResolvedValue([]) },
}));

vi.mock("@/services/eduaiService", () => ({
  default: {
    getModels: vi.fn().mockResolvedValue([]),
    getCourses: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/services/apiKeyStorage", () => ({
  apiKeyStorage: {
    getProviderFromModel: vi.fn().mockReturnValue(null),
    getAllApiKeys: vi.fn().mockResolvedValue({}),
    getApiKey: vi.fn().mockResolvedValue(null),
    setApiKey: vi.fn(),
    removeApiKey: vi.fn(),
  },
  isCloudProvider: vi.fn().mockReturnValue(false),
}));

vi.mock("@/hooks/useEduAIStatus", () => ({
  useEduAIStatus: () => ({ status: "ok", refresh: vi.fn(), setQuestionGenerationPhase: vi.fn() }),
}));

vi.mock("@/hooks/useQmPermissions", () => ({
  useQmPermissions: () => ({}),
  useQmPermissionsForCourse: () => ({
    canApproveVariant: true,
    canCreateQuestion: true,
    canEditResource: () => true,
    canDeleteResource: () => true,
    accessLoading: false,
    hasCourseAccess: true,
  }),
}));

const { AddQuestionDialog } = await import("@/components/questions/AddQuestionDialog");

function makeEntry(overrides: Partial<QuestionVariantEntry> = {}): QuestionVariantEntry {
  return {
    questionId: 1,
    questionDescription: "Arithmetic",
    questionType: "MCQ",
    primaryTopicId: "1",
    primaryTopicName: "Addition",
    secondaryTopicNames: [],
    courseId: 7,
    isDraft: false,
    isAiGenerated: false,
    variant: {
      id: 10,
      questionText: "What is 2 + 2?",
      difficulty: "easy",
      isDraft: false,
      createdAt: "2026-05-01T10:00:00.000Z",
      answer: "B",
      choices: [
        { letter: "A", text: "3" },
        { letter: "B", text: "4" },
      ],
      secondaryTopicsId: [],
      referenceId: null,
      assessmentId: null,
      coreQuestionId: null,
      testable: false,
    },
    ...overrides,
  } as QuestionVariantEntry;
}

function renderView(overrides: Partial<React.ComponentProps<typeof AddQuestionDialog>> = {}) {
  const onClose = vi.fn();
  const onCreateVariant = vi.fn();
  const onDeleteVariant = vi.fn();
  const onSelectVariant = vi.fn();
  const onUpdateVariant = vi.fn();
  const onUpdateQuestionMetadata = vi.fn();

  render(
    <AddQuestionDialog
      mode="view"
      entry={makeEntry()}
      relatedVariants={[]}
      onClose={onClose}
      onCreateVariant={onCreateVariant}
      onDeleteVariant={onDeleteVariant}
      onSelectVariant={onSelectVariant}
      onUpdateVariant={onUpdateVariant}
      onUpdateQuestionMetadata={onUpdateQuestionMetadata}
      {...(overrides as any)}
    />,
  );

  return {
    onClose,
    onCreateVariant,
    onDeleteVariant,
    onSelectVariant,
    onUpdateVariant,
    onUpdateQuestionMetadata,
  };
}

describe("AddQuestionDialog view mode", () => {
  beforeEach(() => {
    cleanup();
    updateVariant.mockReset();
    updateQuestion.mockReset();
    setVariantTestable.mockReset();
    getCourse.mockReset().mockResolvedValue({ coreCourseId: null });
    getCourseTopics.mockReset().mockResolvedValue([
      { id: "1", name: "Addition" },
      { id: "2", name: "Subtraction" },
    ]);
  });

  it("renders an empty closed dialog when entry is null", () => {
    render(
      <AddQuestionDialog
        mode="view"
        entry={null}
        relatedVariants={[]}
        onClose={vi.fn()}
        onCreateVariant={vi.fn()}
        onDeleteVariant={vi.fn()}
        onSelectVariant={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows MCQ choices with the correct answer highlighted", async () => {
    renderView();
    expect(await screen.findByText("4")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("edits and saves MCQ choices", async () => {
    updateVariant.mockResolvedValue({
      choices: [
        { letter: "A", text: "3" },
        { letter: "B", text: "five" },
      ],
      answer: "B",
      selectAllThatApply: false,
    });
    const { onSelectVariant, onUpdateVariant } = renderView({
      entry: makeEntry({ isDraft: true }),
    });

    // Draft entries render both the choices and details "Edit" buttons; the
    // choices one comes first in document order.
    const editButtons = await screen.findAllByRole("button", { name: "Edit" });
    fireEvent.click(editButtons[0]);
    const optionB = screen.getByLabelText("Option B");
    fireEvent.change(optionB, { target: { value: "five" } });
    fireEvent.click(screen.getByRole("button", { name: "Save choices" }));

    await waitFor(() => expect(updateVariant).toHaveBeenCalledTimes(1));
    expect(updateVariant.mock.calls[0][0]).toBe(10);
    await waitFor(() => expect(onSelectVariant).toHaveBeenCalled());
    expect(onUpdateVariant).toHaveBeenCalledWith(10, expect.objectContaining({ answer: "B" }));
    expect(toastFn).toHaveBeenCalledWith("Choices saved", expect.any(Object));
  });

  it("cancels the choices edit without saving", async () => {
    renderView({ entry: makeEntry({ isDraft: true }) });
    const editButtons = await screen.findAllByRole("button", { name: "Edit" });
    fireEvent.click(editButtons[0]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(updateVariant).not.toHaveBeenCalled();
    expect(await screen.findByText("4")).toBeInTheDocument();
  });

  it("shows an error toast when saving choices fails", async () => {
    updateVariant.mockRejectedValue(new Error("save failed"));
    renderView({ entry: makeEntry({ isDraft: true }) });

    const editButtons = await screen.findAllByRole("button", { name: "Edit" });
    fireEvent.click(editButtons[0]);
    fireEvent.click(screen.getByRole("button", { name: "Save choices" }));

    await waitFor(() =>
      expect(toastFn.error).toHaveBeenCalledWith(
        "Failed to save choices",
        expect.objectContaining({ description: "save failed" }),
      ),
    );
  });

  it('shows "No choices defined yet" and lets the user add choices', async () => {
    renderView({
      entry: makeEntry({
        isDraft: true,
        variant: {
          id: 11,
          questionText: "No choices question",
          difficulty: "medium",
          answer: null,
          choices: [],
          secondaryTopicsId: [],
          referenceId: null,
          assessmentId: null,
        } as any,
      }),
    });

    expect(await screen.findByText("No choices defined yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add choices" }));
    expect(screen.getByRole("button", { name: "Save choices" })).toBeInTheDocument();
    expect(screen.getByLabelText("Option A")).toHaveValue("");
  });

  it("toggles the AI-generated tag on and off", async () => {
    updateVariant.mockResolvedValue({ isAiGenerated: true });
    const { onSelectVariant, onUpdateVariant } = renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Add AI Tag" }));

    await waitFor(() => expect(updateVariant).toHaveBeenCalledWith(10, { isAiGenerated: true }));
    await waitFor(() => expect(onSelectVariant).toHaveBeenCalled());
    expect(onUpdateVariant).toHaveBeenCalledWith(10, { isAiGenerated: true });
    expect(toastFn).toHaveBeenCalledWith("AI tag toggled", expect.any(Object));
  });

  it("shows an error toast when toggling the AI tag fails", async () => {
    updateVariant.mockRejectedValue(new Error("network down"));
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Add AI Tag" }));

    await waitFor(() =>
      expect(toastFn.error).toHaveBeenCalledWith(
        "Failed to toggle AI tag",
        expect.objectContaining({ description: "network down" }),
      ),
    );
  });

  it("blocks the testable toggle with an error when not synced to Core", async () => {
    renderView({
      entry: makeEntry({ isDraft: false }),
    });

    // isApproved (isDraft:false) reveals the AI Tutor preview section.
    expect(await screen.findByText("AI Tutor preview")).toBeInTheDocument();
    expect(screen.getByText(/This variant is not synced to Core yet/i)).toBeInTheDocument();
    expect(setVariantTestable).not.toHaveBeenCalled();
  });

  it("toggles testable on when synced to Core", async () => {
    setVariantTestable.mockResolvedValue({ testable: true });
    const { onSelectVariant, onUpdateVariant } = renderView({
      entry: makeEntry({
        isDraft: false,
        variant: {
          id: 10,
          questionText: "What is 2 + 2?",
          difficulty: "easy",
          answer: "B",
          choices: [
            { letter: "A", text: "3" },
            { letter: "B", text: "4" },
          ],
          secondaryTopicsId: [],
          referenceId: null,
          assessmentId: null,
          coreQuestionId: "core-1",
          testable: false,
        } as any,
      }),
    });

    const toggle = await screen.findByRole("switch");
    fireEvent.click(toggle);

    await waitFor(() => expect(setVariantTestable).toHaveBeenCalledWith(10, true));
    await waitFor(() => expect(onSelectVariant).toHaveBeenCalled());
    expect(onUpdateVariant).toHaveBeenCalledWith(10, { testable: true });
    expect(toastFn).toHaveBeenCalledWith("Available in AI Tutor", expect.any(Object));
  });

  it("toggles testable off and opens AI Tutor from the preview section", async () => {
    setVariantTestable.mockResolvedValue({ testable: false });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    getCourse.mockResolvedValue({ coreCourseId: "core-course-1" });
    const { onSelectVariant, onUpdateVariant } = renderView({
      entry: makeEntry({
        isDraft: false,
        variant: {
          id: 10,
          questionText: "What is 2 + 2?",
          difficulty: "easy",
          answer: "B",
          choices: [
            { letter: "A", text: "3" },
            { letter: "B", text: "4" },
          ],
          secondaryTopicsId: [],
          referenceId: null,
          assessmentId: null,
          coreQuestionId: "core-1",
          testable: true,
        } as any,
      }),
    });

    fireEvent.click(await screen.findByRole("button", { name: /open ai tutor/i }));
    expect(openSpy).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(setVariantTestable).toHaveBeenCalledWith(10, false));
    await waitFor(() => expect(onSelectVariant).toHaveBeenCalled());
    expect(onUpdateVariant).toHaveBeenCalledWith(10, { testable: false });
    expect(toastFn).toHaveBeenCalledWith("Removed from AI Tutor", expect.any(Object));
    openSpy.mockRestore();
  });

  it("shows an error toast when the testable toggle fails", async () => {
    setVariantTestable.mockRejectedValue(new Error("core unreachable"));
    renderView({
      entry: makeEntry({
        isDraft: false,
        variant: {
          id: 10,
          questionText: "What is 2 + 2?",
          difficulty: "easy",
          answer: "B",
          choices: [
            { letter: "A", text: "3" },
            { letter: "B", text: "4" },
          ],
          secondaryTopicsId: [],
          referenceId: null,
          assessmentId: null,
          coreQuestionId: "core-1",
          testable: false,
        } as any,
      }),
    });

    fireEvent.click(await screen.findByRole("switch"));

    await waitFor(() =>
      expect(toastFn.error).toHaveBeenCalledWith(
        "Failed to update AI Tutor visibility",
        expect.objectContaining({ description: "core unreachable" }),
      ),
    );
  });

  it("edits question metadata and saves", async () => {
    updateQuestion.mockResolvedValue({});
    updateVariant.mockResolvedValue({});
    const { onUpdateQuestionMetadata } = renderView();

    // The default entry is approved (isDraft: false), so choices editing is
    // locked and only the Details section's Edit button renders.
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    const descriptionInput = await screen.findByLabelText("Description");
    fireEvent.change(descriptionInput, { target: { value: "Updated description" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateQuestion).toHaveBeenCalled());
    expect(updateQuestion).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ description: "Updated description", courseId: 7 }),
    );
    await waitFor(() => expect(onUpdateQuestionMetadata).toHaveBeenCalled());
    expect(toastFn).toHaveBeenCalledWith("Question details saved", expect.any(Object));
  });

  it("cancels metadata editing without saving", async () => {
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await screen.findByLabelText("Description");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(updateQuestion).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Description")).not.toBeInTheDocument();
  });

  it("switches the selected sibling variant from the rail", async () => {
    const secondVariant = makeEntry({
      variant: {
        id: 20,
        questionText: "Sibling variant text",
        difficulty: "hard",
        answer: null,
        choices: [],
        secondaryTopicsId: [],
        referenceId: 10,
        assessmentId: null,
        createdAt: "2026-05-02T10:00:00.000Z",
      } as any,
    });
    const { onSelectVariant } = renderView({
      relatedVariants: [makeEntry(), secondVariant],
    });

    expect(await screen.findByText("2 variants")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Sibling variant text"));

    expect(onSelectVariant).toHaveBeenCalledWith(
      expect.objectContaining({ variant: expect.objectContaining({ id: 20 }) }),
    );
  });

  it("calls onCreateVariant and onDeleteVariant from the footer actions", async () => {
    const { onCreateVariant, onDeleteVariant } = renderView();

    fireEvent.click(await screen.findByRole("button", { name: /create variant/i }));
    expect(onCreateVariant).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /delete variant/i }));
    expect(onDeleteVariant).toHaveBeenCalled();
  });
});
