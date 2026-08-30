/**
 * Unit tests for AddQuestionDialog's create/"new" mode (#1545) — the manual
 * MCQ save flow, required-field validation, cancel, and the AI-generate
 * success/error paths. View-mode is covered separately by
 * AddQuestionDialogReviewConfirm.test.tsx; this file exercises the other
 * ~half of the component that was previously untested.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const questionService = {
  createQuestion: vi.fn(),
  createVariant: vi.fn(),
  getQuestion: vi.fn(),
  updateVariant: vi.fn(),
};
const courseService = {
  getCourseTopics: vi.fn(),
  getCourse: vi.fn(),
};
const assessmentServiceDefault = { getAssessments: vi.fn() };
const eduaiServiceDefault = {
  listModels: vi.fn(),
  listCourses: vi.fn(),
  generateQuestions: vi.fn(),
};
const apiKeyStorage = {
  getProviderFromModel: vi.fn().mockReturnValue(null),
  getApiKey: vi.fn().mockResolvedValue(null),
  getAllApiKeys: vi.fn().mockResolvedValue({}),
  setApiKey: vi.fn(),
  removeApiKey: vi.fn(),
  buildApiKeysForModel: vi.fn().mockResolvedValue({}),
  requiresApiKey: vi.fn().mockReturnValue(false),
};

vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/services/questionService", () => ({ questionService }));
vi.mock("@/services/courseService", () => ({ courseService }));
vi.mock("@/services/assessmentService", () => ({ default: assessmentServiceDefault }));
vi.mock("@/services/eduaiService", () => ({ default: eduaiServiceDefault }));
vi.mock("@/services/apiKeyStorage", () => ({
  apiKeyStorage,
  isCloudProvider: vi.fn(() => false),
  isCampusProvider: vi.fn(() => false),
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

const topics = [
  { id: "t1", name: "Topic One" },
  { id: "t2", name: "Topic Two" },
];

function renderNew(overrides: Partial<React.ComponentProps<typeof AddQuestionDialog>> = {}) {
  const onQuestionCreated = vi.fn();
  const onClose = vi.fn();
  render(
    <AddQuestionDialog
      mode="new"
      open
      onClose={onClose}
      courseId={7}
      variants={[]}
      onQuestionCreated={onQuestionCreated}
      {...(overrides as any)}
    />,
  );
  return { onQuestionCreated, onClose };
}

function fillQuestionText(text: string) {
  const textarea = document.getElementById("aq-variant-text") as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: text } });
}

/**
 * Metadata panel renders Type then Primary Topic as the first two comboboxes
 * (see QuestionMetadataPanel); addressed by order since neither SelectTrigger
 * carries an id/htmlFor pairing with its Label.
 */
async function selectPrimaryTopic(label: string) {
  await waitFor(() => {
    const combo = screen.getAllByRole("combobox")[1];
    expect(combo).not.toBeDisabled();
  });
  const combo = screen.getAllByRole("combobox")[1];
  fireEvent.click(combo);
  const options = await screen.findAllByText(label);
  fireEvent.click(options[options.length - 1]);
}

describe("AddQuestionDialog create mode", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    courseService.getCourseTopics.mockResolvedValue(topics);
    courseService.getCourse.mockResolvedValue({ id: 7, code: "COSC101", name: "Intro" });
    assessmentServiceDefault.getAssessments.mockResolvedValue([]);
    eduaiServiceDefault.listModels.mockResolvedValue([]);
    eduaiServiceDefault.listCourses.mockResolvedValue([]);
    apiKeyStorage.getProviderFromModel.mockReturnValue(null);
  });

  it("does not submit when required fields are missing", async () => {
    renderNew();
    await screen.findByText("Question Parameters");
    // No question text / MCQ answer yet — clicking Save must not call the service.
    fireEvent.click(screen.getByText("Save as Draft"));
    expect(questionService.createQuestion).not.toHaveBeenCalled();
  });

  it("creates a manual MCQ question and calls onQuestionCreated", async () => {
    questionService.createQuestion.mockResolvedValue({ id: 100 });
    questionService.createVariant.mockResolvedValue({ id: 200 });
    questionService.getQuestion.mockResolvedValue({ id: 100, description: "desc" });
    const { onQuestionCreated, onClose } = renderNew();

    await selectPrimaryTopic("Topic One");
    fillQuestionText("What is 2 + 2?");
    fireEvent.change(screen.getByLabelText("Option A"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Option B"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Mark option B correct" }));

    // Mark as reviewed so the Save button reads "Create Question".
    fireEvent.click(screen.getByLabelText("Mark as reviewed"));
    const saveBtn = await screen.findByText("Create Question");
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
    fireEvent.click(saveBtn);

    await waitFor(() => expect(questionService.createQuestion).toHaveBeenCalled());
    expect(questionService.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 7, primaryTopicId: "t1", type: "MCQ" }),
    );
    await waitFor(() =>
      expect(questionService.createVariant).toHaveBeenCalledWith(
        100,
        expect.objectContaining({ questionText: "What is 2 + 2?", isDraft: false }),
      ),
    );
    await waitFor(() => expect(onQuestionCreated).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("saves as a draft by default (Mark as reviewed unchecked)", async () => {
    questionService.createQuestion.mockResolvedValue({ id: 101 });
    questionService.createVariant.mockResolvedValue({ id: 201 });
    questionService.getQuestion.mockResolvedValue({ id: 101 });
    renderNew();

    await selectPrimaryTopic("Topic One");
    fillQuestionText("Explain recursion.");
    fireEvent.change(screen.getByLabelText("Option A"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Option B"), { target: { value: "y" } });
    fireEvent.click(screen.getByRole("button", { name: "Mark option A correct" }));

    const saveBtn = await screen.findByText("Save as Draft");
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
    fireEvent.click(saveBtn);

    await waitFor(() =>
      expect(questionService.createVariant).toHaveBeenCalledWith(
        101,
        expect.objectContaining({ isDraft: true }),
      ),
    );
  });

  it("shows a save error when question creation fails", async () => {
    questionService.createQuestion.mockRejectedValue({ response: { data: { error: "boom" } } });
    renderNew();

    await selectPrimaryTopic("Topic One");
    fillQuestionText("Explain recursion.");
    fireEvent.change(screen.getByLabelText("Option A"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Option B"), { target: { value: "y" } });
    fireEvent.click(screen.getByRole("button", { name: "Mark option A correct" }));
    fireEvent.click(screen.getByLabelText("Mark as reviewed"));

    const saveBtn = await screen.findByText("Create Question");
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
    fireEvent.click(saveBtn);

    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
  });

  it("calls onClose from the Cancel button", async () => {
    const { onClose } = renderNew();
    await screen.findByText("Question Parameters");
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("generates a question via AI and populates the form", async () => {
    eduaiServiceDefault.generateQuestions.mockResolvedValue({
      data: {
        questions: [
          {
            type: "MCQ",
            difficulty: "hard",
            content: "AI generated question text",
            choices: [
              { letter: "A", text: "Wrong" },
              { letter: "B", text: "Right" },
            ],
            answer: "B",
            description: "AI desc",
          },
        ],
      },
    });
    renderNew();
    await screen.findByText("Question Parameters");

    fireEvent.click(screen.getByLabelText("Generate with AI assistant"));
    const promptBox = await screen.findByPlaceholderText(/Time complexity of quicksort/);
    fireEvent.change(promptBox, { target: { value: "Sorting algorithms" } });
    fireEvent.click(screen.getByText("Generate question"));

    await waitFor(() =>
      expect(screen.getByDisplayValue("AI generated question text")).toBeInTheDocument(),
    );
    expect(eduaiServiceDefault.generateQuestions).toHaveBeenCalled();
  });

  it("prefills the form from presetVariant in variant mode and creates a variant", async () => {
    questionService.createVariant.mockResolvedValue({ id: 300 });
    questionService.getQuestion.mockResolvedValue({ id: 5 });
    const presetVariant = {
      questionId: 5,
      questionDescription: "Base question",
      questionType: "SA",
      primaryTopicId: "t1",
      variant: {
        id: 50,
        questionText: "Base variant text",
        difficulty: "medium",
        answer: "Base answer",
      },
    };
    const { onQuestionCreated, onClose } = renderNew({ mode: "variant", presetVariant } as any);

    expect(await screen.findByText("Add Variant: Base question")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Base variant text")).toBeInTheDocument();

    const saveBtn = await screen.findByText("Add Variant");
    fireEvent.click(saveBtn);

    await waitFor(() =>
      expect(questionService.createVariant).toHaveBeenCalledWith(
        5,
        expect.objectContaining({ questionText: "Base variant text" }),
      ),
    );
    await waitFor(() => expect(onQuestionCreated).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an error toast and modal when AI generation fails", async () => {
    eduaiServiceDefault.generateQuestions.mockRejectedValue({
      response: { data: { error: "AI service down" } },
    });
    renderNew();
    await screen.findByText("Question Parameters");

    fireEvent.click(screen.getByLabelText("Generate with AI assistant"));
    const promptBox = await screen.findByPlaceholderText(/Time complexity of quicksort/);
    fireEvent.change(promptBox, { target: { value: "Sorting algorithms" } });
    fireEvent.click(screen.getByText("Generate question"));

    await waitFor(() => expect(screen.getByText("AI service down")).toBeInTheDocument());
  });

  it("shows an error when generating without a course selected", async () => {
    renderNew({ courseId: null });
    await screen.findByText("Question Parameters");

    fireEvent.click(screen.getByLabelText("Generate with AI assistant"));
    const promptBox = await screen.findByPlaceholderText(/Time complexity of quicksort/);
    fireEvent.change(promptBox, { target: { value: "Sorting algorithms" } });
    fireEvent.click(screen.getByText("Generate question"));

    await waitFor(() =>
      expect(screen.getByText("Select a course before generating a question.")).toBeInTheDocument(),
    );
    expect(eduaiServiceDefault.generateQuestions).not.toHaveBeenCalled();
  });

  it("shows a course-code warning when the AI service doesn't recognize the course", async () => {
    courseService.getCourse.mockResolvedValue({ id: 7, code: "XYZ999", name: "Unlisted Course" });
    eduaiServiceDefault.listCourses.mockResolvedValue([
      { id: "1", code: "CPSC100", name: "Intro to CS" },
    ]);
    renderNew();
    await screen.findByText("Question Parameters");

    fireEvent.click(screen.getByLabelText("Generate with AI assistant"));

    expect(
      await screen.findByText(/AI service does not recognize course code "XYZ999"/i),
    ).toBeInTheDocument();
  });
});
