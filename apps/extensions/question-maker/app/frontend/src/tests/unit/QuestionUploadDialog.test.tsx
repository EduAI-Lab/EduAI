/**
 * #1545 — render + interaction coverage for QuestionUploadDialog's main flows:
 * the no-course guard, file selection -> OCR -> extraction -> review, draft
 * editing, validation-blocked save, a successful save, and the close/discard
 * confirmation. Heavy dependencies (OCR/pdf/tesseract, AI + question services,
 * OCR history, toasts) are mocked so tests exercise the dialog's own logic.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { Topic } from "@/types/topic";

const toastError = vi.fn();
const toastFn = vi.fn() as unknown as typeof toastFn & { error: typeof toastError };
(toastFn as any).error = toastError;
vi.mock("sonner", () => ({
  toast: Object.assign((...args: unknown[]) => (toastFn as any)(...args), { error: toastError }),
}));

const extractQuestionsFromText = vi.fn();
const saveExtractedQuestions = vi.fn();
vi.mock("@/services/questionService", () => ({
  questionService: {
    extractQuestionsFromText: (...args: unknown[]) => extractQuestionsFromText(...args),
    saveExtractedQuestions: (...args: unknown[]) => saveExtractedQuestions(...args),
  },
}));

const listModels = vi.fn();
vi.mock("@/services/eduaiService", () => ({
  eduaiService: { listModels: (...args: unknown[]) => listModels(...args) },
  default: { listModels: (...args: unknown[]) => listModels(...args) },
}));

const getProviderFromModel = vi.fn().mockReturnValue(null);
const getApiKey = vi.fn().mockResolvedValue(null);
const setApiKey = vi.fn().mockResolvedValue(undefined);
const removeApiKey = vi.fn();
const requiresApiKey = vi.fn().mockReturnValue(false);
vi.mock("@/services/apiKeyStorage", () => ({
  apiKeyStorage: {
    getProviderFromModel: (...args: unknown[]) => getProviderFromModel(...args),
    getApiKey: (...args: unknown[]) => getApiKey(...args),
    setApiKey: (...args: unknown[]) => setApiKey(...args),
    removeApiKey: (...args: unknown[]) => removeApiKey(...args),
    requiresApiKey: (...args: unknown[]) => requiresApiKey(...args),
    buildApiKeysForModel: vi.fn().mockResolvedValue({}),
  },
  isCloudProvider: vi.fn().mockReturnValue(false),
  isCampusProvider: vi.fn().mockReturnValue(true),
}));

vi.mock("@/hooks/useEduAIStatus", () => ({
  useEduAIStatus: () => ({
    status: "ok",
    message: undefined,
    provider: "vllm",
    refresh: vi.fn(),
    setQuestionGenerationPhase: vi.fn(),
  }),
}));

const addJob = vi.fn(() => "job-1");
const updateJobStatus = vi.fn();
const removeJob = vi.fn();
const clearHistory = vi.fn();
let ocrJobs: unknown[] = [];
vi.mock("@/hooks/use-ocr-history", () => ({
  useOCRHistory: () => ({
    jobs: ocrJobs,
    addJob,
    updateJob: vi.fn(),
    updateJobStatus,
    removeJob,
    clearHistory,
    getJobsByStatus: vi.fn().mockReturnValue([]),
    getJobsByCourse: vi.fn().mockReturnValue([]),
    getJob: vi.fn(),
  }),
}));

const { QuestionUploadDialog, mapExtractedToDraftQuestions } =
  await import("@/components/question-bank/QuestionUploadDialog");

const topics: Topic[] = [
  { id: "t1", name: "Algebra", courseId: 7, createdAt: "", updatedAt: "" },
  { id: "t2", name: "Geometry", courseId: 7, createdAt: "", updatedAt: "" },
];

function makeTxtFile(contents = "What is 2 + 2?") {
  return new File([contents], "questions.txt", { type: "text/plain" });
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof QuestionUploadDialog>> = {}) {
  const onClose = vi.fn();
  const onQuestionsSaved = vi.fn();
  const onEnsureTopics = vi.fn().mockResolvedValue(topics);
  render(
    <QuestionUploadDialog
      open
      onClose={onClose}
      courseId={7}
      courseName="Biology 101"
      topics={topics}
      onEnsureTopics={onEnsureTopics}
      onQuestionsSaved={onQuestionsSaved}
      {...overrides}
    />,
  );
  return { onClose, onQuestionsSaved, onEnsureTopics };
}

describe("QuestionUploadDialog", () => {
  beforeEach(() => {
    cleanup();
    ocrJobs = [];
    toastFn.mockReset();
    toastError.mockReset();
    extractQuestionsFromText.mockReset();
    saveExtractedQuestions.mockReset();
    listModels.mockReset().mockResolvedValue([]);
    addJob.mockClear();
    updateJobStatus.mockClear();
    getProviderFromModel.mockReset().mockReturnValue(null);
    getApiKey.mockReset().mockResolvedValue(null);
    setApiKey.mockReset().mockResolvedValue(undefined);
    removeApiKey.mockReset();
    requiresApiKey.mockReset().mockReturnValue(false);
  });

  it("shows a guard dialog and does nothing else when there is no course selected", () => {
    const onClose = vi.fn();
    render(
      <QuestionUploadDialog
        open
        onClose={onClose}
        courseId={null}
        topics={[]}
        onEnsureTopics={vi.fn()}
        onQuestionsSaved={vi.fn()}
      />,
    );

    expect(screen.getByText("No course selected")).toBeInTheDocument();
    const closeButtons = screen.getAllByRole("button", { name: "Close" });
    // The dialog also has Radix's built-in "X" close affordance (same accessible
    // name); the footer's explicit Close button is the one without that slot.
    const footerClose = closeButtons.find(
      (btn) => btn.getAttribute("data-slot") !== "dialog-close",
    );
    fireEvent.click(footerClose!);
    expect(onClose).toHaveBeenCalledTimes(1);
  }, 15000);

  it("renders the upload zone and assessment-details fields for the default (assessment) target", async () => {
    renderDialog();

    expect(await screen.findByText("Upload Questions")).toBeInTheDocument();
    expect(screen.getByText("Assessment details")).toBeInTheDocument();
    expect(screen.getByText(/Drop PDF, image, or TXT file here/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save questions/i })).toBeDisabled();
  });

  it('renders the "bank only" notice when saveTarget is "bank"', async () => {
    renderDialog({ saveTarget: "bank" });
    expect(await screen.findByText("Question bank only")).toBeInTheDocument();
    expect(screen.queryByText("Assessment details")).not.toBeInTheDocument();
  });

  it("extracts questions from an uploaded TXT file and shows the review step", async () => {
    extractQuestionsFromText.mockResolvedValue([
      {
        question: "What is 2 + 2?",
        summary: "Basic addition",
        type: "SA",
        difficulty: "easy",
        answer: "4",
      },
    ]);
    renderDialog();

    const fileInput = document.getElementById("question-upload") as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [makeTxtFile()] } });

    await waitFor(() => expect(extractQuestionsFromText).toHaveBeenCalledTimes(1));
    expect(extractQuestionsFromText).toHaveBeenCalledWith(
      expect.objectContaining({ text: "What is 2 + 2?", courseId: 7 }),
    );

    expect(await screen.findByText("Review extracted questions (1)")).toBeInTheDocument();
    expect(screen.getByDisplayValue("What is 2 + 2?")).toBeInTheDocument();
    expect(addJob).toHaveBeenCalled();
    expect(updateJobStatus).toHaveBeenCalledWith("job-1", "processing");
  });

  it("shows an error and marks the OCR job failed when extraction throws", async () => {
    extractQuestionsFromText.mockRejectedValue(new Error("AI service unavailable"));
    renderDialog();

    const fileInput = document.getElementById("question-upload") as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [makeTxtFile()] } });

    expect(await screen.findByText("AI service unavailable")).toBeInTheDocument();
    expect(updateJobStatus).toHaveBeenCalledWith("job-1", "error", {
      error: "AI service unavailable",
    });
    expect(toastError).toHaveBeenCalled();
  });

  it("shows an error for an empty text file without calling extraction", async () => {
    renderDialog();

    const fileInput = document.getElementById("question-upload") as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [makeTxtFile("   ")] } });

    expect(await screen.findByText("No text detected in the uploaded file.")).toBeInTheDocument();
    expect(extractQuestionsFromText).not.toHaveBeenCalled();
  });

  it('toggles a draft question out of "included" and reflects the ready-to-save count', async () => {
    extractQuestionsFromText.mockResolvedValue([
      { question: "Q1", summary: "S1", type: "SA", difficulty: "easy", answer: "A1" },
    ]);
    renderDialog();

    fireEvent.change(document.getElementById("question-upload") as HTMLInputElement, {
      target: { files: [makeTxtFile("Q1 text")] },
    });
    await screen.findByText("Review extracted questions (1)");

    expect(screen.getByText("1 question ready to save.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Included" }));
    expect(screen.getByText("0 questions ready to save.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excluded" })).toBeInTheDocument();
  });

  it("removes a draft question from the review list", async () => {
    extractQuestionsFromText.mockResolvedValue([
      { question: "Q1", summary: "S1", type: "SA", difficulty: "easy", answer: "A1" },
    ]);
    renderDialog();

    fireEvent.change(document.getElementById("question-upload") as HTMLInputElement, {
      target: { files: [makeTxtFile("Q1 text")] },
    });
    await screen.findByText("Review extracted questions (1)");

    fireEvent.click(screen.getByRole("button", { name: /remove question/i }));
    // Removing the only draft drops draftQuestions to 0, and the dialog falls
    // back to the pre-review "Upload a file" card rather than a "(0)" review heading.
    expect(screen.queryByText(/Review extracted questions/)).not.toBeInTheDocument();
    expect(screen.getByText("Upload a file")).toBeInTheDocument();
  });

  it("fills assessment name/type and saves, then closes and reports the saved questions", async () => {
    extractQuestionsFromText.mockResolvedValue([
      { question: "Q1", summary: "S1", type: "SA", difficulty: "easy", answer: "A1" },
    ]);
    saveExtractedQuestions.mockResolvedValue({
      questions: [{ id: 1 }],
      assessmentId: 55,
    });
    const { onClose, onQuestionsSaved } = renderDialog();

    fireEvent.change(document.getElementById("question-upload") as HTMLInputElement, {
      target: { files: [makeTxtFile("Q1 text")] },
    });
    await screen.findByText("Review extracted questions (1)");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Quiz 1" } });
    const saveButton = screen.getByRole("button", { name: /save questions/i });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() => expect(saveExtractedQuestions).toHaveBeenCalledTimes(1));
    expect(saveExtractedQuestions).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId: 7,
        assessment: { type: "Assignment", name: "Quiz 1" },
      }),
    );
    await waitFor(() =>
      expect(onQuestionsSaved).toHaveBeenCalledWith([{ id: 1 }], { assessmentId: 55 }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('saves directly to the bank without an assessment name when saveTarget is "bank"', async () => {
    extractQuestionsFromText.mockResolvedValue([
      { question: "Q1", summary: "S1", type: "SA", difficulty: "easy", answer: "A1" },
    ]);
    saveExtractedQuestions.mockResolvedValue({ questions: [{ id: 2 }], assessmentId: null });
    renderDialog({ saveTarget: "bank" });

    fireEvent.change(document.getElementById("question-upload") as HTMLInputElement, {
      target: { files: [makeTxtFile("Q1 text")] },
    });
    await screen.findByText("Review extracted questions (1)");

    const saveButton = screen.getByRole("button", { name: /save questions/i });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() => expect(saveExtractedQuestions).toHaveBeenCalledTimes(1));
    expect(saveExtractedQuestions.mock.calls[0][0].assessment).toBeUndefined();
  });

  it("shows an unsaved-changes confirmation when closing mid-review, and discarding closes the dialog", async () => {
    extractQuestionsFromText.mockResolvedValue([
      { question: "Q1", summary: "S1", type: "SA", difficulty: "easy", answer: "A1" },
    ]);
    const { onClose } = renderDialog();

    fireEvent.change(document.getElementById("question-upload") as HTMLInputElement, {
      target: { files: [makeTxtFile("Q1 text")] },
    });
    await screen.findByText("Review extracted questions (1)");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /discard/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(updateJobStatus).toHaveBeenCalledWith("job-1", "discarded", expect.any(Object));
  });

  it("closes immediately with no confirmation when there are no unsaved drafts", async () => {
    const { onClose } = renderDialog();
    await screen.findByText("Upload Questions");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("resets the upload after extraction so a new file can be selected", async () => {
    extractQuestionsFromText.mockResolvedValue([
      { question: "Q1", summary: "S1", type: "SA", difficulty: "easy", answer: "A1" },
    ]);
    renderDialog();

    fireEvent.change(document.getElementById("question-upload") as HTMLInputElement, {
      target: { files: [makeTxtFile("Q1 text")] },
    });
    await screen.findByText("Review extracted questions (1)");

    // The "Upload & model" panel (which holds the reset control) is collapsed
    // by default once drafts exist — expand it first.
    fireEvent.click(screen.getByText("Upload & model"));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.queryByText(/Review extracted questions/)).not.toBeInTheDocument();
    expect(screen.getByText("Upload a file")).toBeInTheDocument();
  });

  it("opens and closes the history panel", async () => {
    renderDialog();
    await screen.findByText("Upload Questions");
    const historyButton = screen.getByRole("button", { name: /history/i });
    fireEvent.click(historyButton);
    expect(await screen.findByText("No recent uploads")).toBeInTheDocument();
  });

  it("shows a different-course toast when selecting a history job for another course", async () => {
    ocrJobs = [
      {
        id: "job-2",
        fileName: "old.pdf",
        courseId: 99,
        courseName: "Chemistry 101",
        model: "vllm:qwen2.5-32b-instruct",
        status: "success",
        createdAt: new Date().toISOString(),
        storedQuestions: [{ id: "q1", text: "Q", type: "mcq" }],
      } as any,
    ];
    renderDialog();
    await screen.findByText("Upload Questions");
    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    const jobCard = await screen.findByText("old.pdf");
    const outer = jobCard.closest('[role="button"]') as HTMLElement;
    fireEvent.click(outer);
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Different course", expect.any(Object)),
    );
  });

  it("restores stored questions from a matching-course history job with no pending drafts", async () => {
    ocrJobs = [
      {
        id: "job-3",
        fileName: "restore.pdf",
        courseId: 7,
        courseName: "Biology 101",
        model: "vllm:qwen2.5-32b-instruct",
        status: "success",
        createdAt: new Date().toISOString(),
        storedQuestions: [{ id: "q1", text: "Restored Q", summary: "S", type: "short_answer" }],
      } as any,
    ];
    renderDialog();
    await screen.findByText("Upload Questions");
    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    const jobCard = await screen.findByText("restore.pdf");
    fireEvent.click(jobCard.closest('[role="button"]') as HTMLElement);

    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith("Questions restored", expect.any(Object)),
    );
  });

  it("confirms replacing unsaved drafts when restoring a different history job", async () => {
    extractQuestionsFromText.mockResolvedValue([
      { question: "Q1", summary: "S1", type: "SA", difficulty: "easy", answer: "A1" },
    ]);
    ocrJobs = [
      {
        id: "job-4",
        fileName: "restore2.pdf",
        courseId: 7,
        courseName: "Biology 101",
        model: "vllm:qwen2.5-32b-instruct",
        status: "success",
        createdAt: new Date().toISOString(),
        storedQuestions: [{ id: "q2", text: "Restored Q2", summary: "S", type: "short_answer" }],
      } as any,
    ];
    renderDialog();

    fireEvent.change(document.getElementById("question-upload") as HTMLInputElement, {
      target: { files: [makeTxtFile("Q1 text")] },
    });
    await screen.findByText("Review extracted questions (1)");

    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    const jobCard = await screen.findByText("restore2.pdf");
    fireEvent.click(jobCard.closest('[role="button"]') as HTMLElement);

    expect(await screen.findByText("Replace current questions?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));

    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith("Questions restored", expect.any(Object)),
    );
  });

  it("warns about an external model and requires an API key input", async () => {
    listModels.mockResolvedValue([
      { id: "vllm:qwen2.5-32b-instruct", label: "Qwen 32B", provider: "vllm" },
      { id: "openai:gpt-4", label: "GPT-4", provider: "openai" },
    ]);
    getProviderFromModel.mockReturnValue("openai");
    requiresApiKey.mockReturnValue(true);
    renderDialog();

    await screen.findByText("Upload Questions");
    fireEvent.click(screen.getByLabelText("AI model"));
    fireEvent.click(await screen.findByRole("option", { name: "GPT-4 (openai)" }));

    expect(
      await screen.findByText(/External models send your prompts and course data/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("OPENAI API Key")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Save key" })).toBeDisabled();
  });

  it("shows a masked existing key and clears it via Change", async () => {
    listModels.mockResolvedValue([{ id: "openai:gpt-4", label: "GPT-4", provider: "openai" }]);
    getProviderFromModel.mockReturnValue("openai");
    requiresApiKey.mockReturnValue(true);
    getApiKey.mockResolvedValue("sk-existing-1234567890");
    renderDialog();

    await screen.findByText("Upload Questions");
    fireEvent.click(screen.getByLabelText("AI model"));
    fireEvent.click(await screen.findByRole("option", { name: "GPT-4 (openai)" }));

    expect(await screen.findByDisplayValue("sk-exist••••••••••••••")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));

    expect(removeApiKey).toHaveBeenCalledWith("openai");
    expect(await screen.findByLabelText("OPENAI API Key")).toHaveValue("");
  });

  it("edits a draft's summary, question text, difficulty, topic, and switches it to MCQ", async () => {
    extractQuestionsFromText.mockResolvedValue([
      { question: "Q1", summary: "S1", type: "SA", difficulty: "easy", answer: "A1" },
    ]);
    renderDialog();

    fireEvent.change(document.getElementById("question-upload") as HTMLInputElement, {
      target: { files: [makeTxtFile("Q1 text")] },
    });
    await screen.findByText("Review extracted questions (1)");

    fireEvent.change(screen.getByDisplayValue("S1"), { target: { value: "Updated summary" } });
    expect(screen.getByDisplayValue("Updated summary")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("Q1"), {
      target: { value: "Updated question text" },
    });
    expect(screen.getByDisplayValue("Updated question text")).toBeInTheDocument();

    const secondaryTopicCheckbox = screen.getByRole("checkbox", { name: "Geometry" });
    fireEvent.click(secondaryTopicCheckbox);
    expect(secondaryTopicCheckbox).toBeChecked();

    // Combobox order: assessment type (left card), then the draft's primary
    // topic, difficulty, and type selects.
    const [, primaryTopicSelect, difficultySelect, typeSelect] = screen.getAllByRole("combobox");

    fireEvent.click(difficultySelect);
    fireEvent.click(await screen.findByRole("option", { name: "hard" }));
    expect(screen.getByText("hard")).toBeInTheDocument();

    fireEvent.click(primaryTopicSelect);
    fireEvent.click(await screen.findByRole("option", { name: "Geometry" }));

    fireEvent.click(typeSelect);
    fireEvent.click(await screen.findByRole("option", { name: "Multiple Choice" }));

    fireEvent.change(screen.getByLabelText("Option A"), { target: { value: "First" } });
    fireEvent.change(screen.getByLabelText("Option B"), { target: { value: "Second" } });
    fireEvent.click(screen.getByRole("button", { name: "Mark option B correct" }));
    expect(screen.getByLabelText("Option A")).toHaveValue("First");
  });

  it("blocks save without calling the service when a draft's summary is cleared", async () => {
    extractQuestionsFromText.mockResolvedValue([
      { question: "Q1", summary: "S1", type: "SA", difficulty: "easy", answer: "A1" },
    ]);
    renderDialog();

    fireEvent.change(document.getElementById("question-upload") as HTMLInputElement, {
      target: { files: [makeTxtFile("Q1 text")] },
    });
    await screen.findByText("Review extracted questions (1)");

    fireEvent.change(screen.getByDisplayValue("S1"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Quiz 1" } });

    const saveButton = screen.getByRole("button", { name: /save questions/i });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    // The missing-summary guard in handleSave rejects the save silently (no
    // visible error surface exists once the dialog is in the review step),
    // so the only observable effect is that the service is never invoked.
    await waitFor(() => expect(saveButton).toHaveTextContent("Save questions"));
    expect(saveExtractedQuestions).not.toHaveBeenCalled();
  });

  it("shows an error toast and stays in review when saving fails", async () => {
    extractQuestionsFromText.mockResolvedValue([
      { question: "Q1", summary: "S1", type: "SA", difficulty: "easy", answer: "A1" },
    ]);
    saveExtractedQuestions.mockRejectedValue({ response: { data: { error: "Save exploded" } } });
    const { onQuestionsSaved, onClose } = renderDialog();

    fireEvent.change(document.getElementById("question-upload") as HTMLInputElement, {
      target: { files: [makeTxtFile("Q1 text")] },
    });
    await screen.findByText("Review extracted questions (1)");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Quiz 1" } });
    fireEvent.click(screen.getByRole("button", { name: /save questions/i }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Save failed",
        expect.objectContaining({ description: "Save exploded" }),
      ),
    );
    expect(await screen.findByText("Review extracted questions (1)")).toBeInTheDocument();
    expect(onQuestionsSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("opens directly to the review step when initialDraftQuestions are provided", async () => {
    const initialDraftQuestions = [
      {
        id: "d1",
        question: "Pre-filled question",
        summary: "Pre-filled summary",
        difficulty: "medium" as const,
        type: "SA" as const,
        answer: "",
        primaryTopicId: null,
        secondaryTopicIds: [],
        include: true,
      },
    ];
    renderDialog({ initialDraftQuestions });

    expect(await screen.findByText("Review extracted questions (1)")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Pre-filled question")).toBeInTheDocument();
    expect(extractQuestionsFromText).not.toHaveBeenCalled();
  });

  it("refreshes topics on mount when none are provided and selects the first one", async () => {
    extractQuestionsFromText.mockResolvedValue([
      { question: "Q1", summary: "S1", type: "SA", difficulty: "easy", answer: "A1" },
    ]);
    const onEnsureTopics = vi.fn().mockResolvedValue(topics);
    renderDialog({ topics: [], onEnsureTopics });
    await waitFor(() => expect(onEnsureTopics).toHaveBeenCalledWith(7));

    fireEvent.change(document.getElementById("question-upload") as HTMLInputElement, {
      target: { files: [makeTxtFile("Q1 text")] },
    });
    await screen.findByText("Review extracted questions (1)");

    // The draft's primary-topic select defaults to the first refreshed topic.
    expect(screen.getByText("Algebra")).toBeInTheDocument();
  });

  it("falls back to an empty topic list when refreshing topics fails", async () => {
    extractQuestionsFromText.mockResolvedValue([
      { question: "Q1", summary: "S1", type: "SA", difficulty: "easy", answer: "A1" },
    ]);
    const onEnsureTopics = vi.fn().mockRejectedValue(new Error("network error"));
    renderDialog({ topics: [], onEnsureTopics });
    await waitFor(() => expect(onEnsureTopics).toHaveBeenCalledWith(7));

    fireEvent.change(document.getElementById("question-upload") as HTMLInputElement, {
      target: { files: [makeTxtFile("Q1 text")] },
    });
    await screen.findByText("Review extracted questions (1)");

    expect(screen.getByText(/No topics available/i)).toBeInTheDocument();
  });

  it("shows the external-model warning and lets an existing key be changed from the expanded upload panel", async () => {
    extractQuestionsFromText.mockResolvedValue([
      { question: "Q1", summary: "S1", type: "SA", difficulty: "easy", answer: "A1" },
    ]);
    listModels.mockResolvedValue([{ id: "openai:gpt-4", label: "GPT-4", provider: "openai" }]);
    getProviderFromModel.mockReturnValue("openai");
    requiresApiKey.mockReturnValue(true);
    getApiKey.mockResolvedValue("sk-existing-1234567890");
    renderDialog();

    fireEvent.change(document.getElementById("question-upload") as HTMLInputElement, {
      target: { files: [makeTxtFile("Q1 text")] },
    });
    await screen.findByText("Review extracted questions (1)");

    fireEvent.click(screen.getByText("Upload & model"));
    expect(
      await screen.findByText(/External models send your prompts and course data/i),
    ).toBeInTheDocument();

    expect(await screen.findByDisplayValue("sk-exist••••••••••••••")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));

    expect(removeApiKey).toHaveBeenCalledWith("openai");
    expect(await screen.findByLabelText("OPENAI API Key")).toHaveValue("");
  });
});

describe("mapExtractedToDraftQuestions", () => {
  it("filters out items missing a question or summary and normalizes MCQ choices", () => {
    const drafts = mapExtractedToDraftQuestions([
      { question: "  ", summary: "x", type: "SA" } as any,
      { question: "y", summary: "", type: "SA" } as any,
      {
        question: "What is the capital of France?",
        summary: "Geography",
        type: "MCQ",
        difficulty: "hard",
        choices: [
          { letter: "a", text: "Paris" },
          { letter: "b", text: "Berlin" },
        ],
        answer: "a",
      } as any,
    ]);

    expect(drafts).toHaveLength(1);
    expect(drafts[0].question).toBe("What is the capital of France?");
    expect(drafts[0].difficulty).toBe("hard");
    expect(drafts[0].choices).toEqual([
      { letter: "A", text: "Paris" },
      { letter: "B", text: "Berlin" },
    ]);
  });

  it("falls back to default MCQ choices when fewer than two valid choices are provided", () => {
    const drafts = mapExtractedToDraftQuestions([
      {
        question: "Pick one",
        summary: "Summary",
        type: "MCQ",
        choices: [{ letter: "A", text: "Only one" }],
      } as any,
    ]);

    expect(drafts[0].choices).toHaveLength(4);
    expect(drafts[0].choices?.[0]).toEqual({ letter: "A", text: "" });
  });

  it("defaults difficulty and type when missing or invalid", () => {
    const drafts = mapExtractedToDraftQuestions([
      { question: "Q", summary: "S", type: "NOT_A_TYPE", difficulty: "extreme" } as any,
    ]);

    expect(drafts[0].difficulty).toBe("medium");
    expect(drafts[0].type).toBe("SA");
  });
});
