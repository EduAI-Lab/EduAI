/**
 * Unit tests for QuestionComposerPage (#1544). Hooks, services, and heavy child
 * components are mocked so we exercise the page's own logic — mode derivation,
 * gate states, validation, save flows (create/variant/edit), and AI generation
 * — without depending on the real design system or network calls.
 *
 * `vi.mock` factories are hoisted above every other top-level statement
 * (including imports), so anything referenced inside one is created via
 * `vi.hoisted` to avoid a TDZ ReferenceError.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

afterEach(cleanup);

type RouteParams = { courseId?: string; questionId?: string };

const {
  navigateMock,
  toastFn,
  useQmPermissionsForCourseMock,
  eduaiStatusMock,
  questionService,
  courseService,
  eduaiService,
  apiKeyStorage,
  routeParams,
  searchParamsBox,
} = vi.hoisted(() => {
  const toast = vi.fn(() => "toast-id") as any;
  toast.error = vi.fn();
  toast.dismiss = vi.fn();
  return {
    navigateMock: vi.fn(),
    toastFn: toast,
    useQmPermissionsForCourseMock: vi.fn(),
    eduaiStatusMock: {
      status: "ok" as const,
      message: undefined,
      provider: undefined,
      questionGenerationPhase: null,
      setQuestionGenerationPhase: vi.fn(),
      refresh: vi.fn(),
    },
    questionService: {
      getQuestion: vi.fn(),
      updateVariant: vi.fn(),
      updateQuestion: vi.fn(),
      createVariant: vi.fn(),
      createQuestion: vi.fn(),
    },
    courseService: {
      getCourse: vi.fn(),
      getCourseTopics: vi.fn(),
    },
    eduaiService: {
      listModels: vi.fn(),
      listCourses: vi.fn(),
      generateQuestions: vi.fn(),
    },
    apiKeyStorage: {
      buildApiKeysForModel: vi.fn(async () => ({})),
      getProviderFromModel: vi.fn(() => "openai"),
      setApiKey: vi.fn(async () => ({ storedRemotely: false })),
    },
    routeParams: { current: { courseId: "5" } as RouteParams },
    searchParamsBox: { current: new URLSearchParams() },
  };
});

vi.mock("react-router", () => ({
  useNavigate: () => navigateMock,
  useParams: () => routeParams.current,
  useSearchParams: () => [searchParamsBox.current, vi.fn()],
}));

vi.mock("sonner", () => ({ toast: toastFn }));

vi.mock("@/hooks/useQmPermissions", () => ({
  useQmPermissionsForCourse: () => useQmPermissionsForCourseMock(),
}));

vi.mock("@/hooks/useEduAIStatus", () => ({
  useEduAIStatus: () => eduaiStatusMock,
}));

vi.mock("@/services/questionService", () => ({ questionService }));
vi.mock("@/services/courseService", () => ({ courseService }));
vi.mock("@/services/eduaiService", () => ({ default: eduaiService }));
vi.mock("@/services/apiKeyStorage", () => ({ apiKeyStorage }));

vi.mock("@eduai/ui", () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
  Card: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h2>{children}</h2>,
  Label: ({ children, htmlFor }: any) => <label htmlFor={htmlFor}>{children}</label>,
  Separator: () => <hr />,
  Skeleton: () => <div data-testid="skeleton" />,
}));

vi.mock("@/components/questions/QuestionAIControls", () => ({
  QuestionAIControls: (props: any) => (
    <div data-testid="ai-controls">
      <button onClick={props.onGenerate}>generate</button>
      <button onClick={() => props.onChange("generationPrompt", "a great prompt")}>
        set-prompt
      </button>
      <button onClick={() => props.onProviderApiKeyChange("sk-test")}>set-key</button>
      <button onClick={props.onSaveProviderApiKey}>save-key</button>
      <span data-testid="api-key-state">{props.apiKeySaveState}</span>
      <span data-testid="ai-status">{props.status}</span>
      <button onClick={() => props.onQuestionCountChange?.(3)}>set-count-3</button>
      <span data-testid="has-count">{String(Boolean(props.onQuestionCountChange))}</span>
    </div>
  ),
}));

vi.mock("@/components/questions/QuestionOutputPanel", () => ({
  QuestionOutputPanel: (props: any) => (
    <div data-testid="output-panel">
      <span data-testid="question-text">{props.variantText}</span>
      <button onClick={() => props.onVariantTextChange("What is 2+2?")}>set-text</button>
      <button onClick={() => props.onVariantAnswerChange("A")}>set-answer</button>
      <button
        onClick={() =>
          props.onVariantChoicesChange([
            { letter: "A", text: "4" },
            { letter: "B", text: "5" },
          ])
        }
      >
        set-choices
      </button>
      <button onClick={props.onClear}>clear</button>
    </div>
  ),
}));

vi.mock("@/components/composer/QuestionTypeSelector", () => ({
  QuestionTypeSelector: (props: any) => (
    <div data-testid="type-selector">
      <button onClick={() => props.onChange("SA")}>set-type-sa</button>
    </div>
  ),
}));

vi.mock("@/components/composer/ComposerMetadataFields", () => ({
  ComposerMetadataFields: (props: any) => (
    <div data-testid="metadata-fields">
      <button onClick={() => props.onPrimaryTopicChange("t1")}>set-primary-topic</button>
      <button onClick={() => props.onDescriptionChange("a description")}>set-description</button>
      <span data-testid="primary-topic-error">{props.errors?.primaryTopic}</span>
    </div>
  ),
}));

import { QuestionComposerPage } from "@/pages/QuestionComposerPage";

function setDefaultMocks() {
  routeParams.current = { courseId: "5" };
  searchParamsBox.current = new URLSearchParams();
  useQmPermissionsForCourseMock.mockReturnValue({
    canApproveVariant: true,
    canCreateQuestion: true,
    hasCourseAccess: true,
    accessLoading: false,
  });
  courseService.getCourse.mockResolvedValue({ id: 5, code: "TST101", name: "Testing" });
  courseService.getCourseTopics.mockResolvedValue([{ id: "t1", name: "Topic 1" }]);
  eduaiService.listModels.mockResolvedValue([{ id: "gpt", name: "GPT" }]);
  eduaiService.listCourses.mockResolvedValue([{ id: "5", name: "Testing", code: "TST101" }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  eduaiStatusMock.status = "ok";
  eduaiStatusMock.questionGenerationPhase = null;
  setDefaultMocks();
});

describe("QuestionComposerPage gate states", () => {
  it("shows a not-found card when the course id is invalid", () => {
    routeParams.current = { courseId: "not-a-number" };
    render(<QuestionComposerPage />);
    expect(screen.getByText("This course could not be found.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to courses" }));
    expect(navigateMock).toHaveBeenCalledWith("/courses");
  });

  it("shows a skeleton while access is loading", () => {
    useQmPermissionsForCourseMock.mockReturnValue({
      canCreateQuestion: false,
      hasCourseAccess: false,
      accessLoading: true,
    });
    render(<QuestionComposerPage />);
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("shows a read-only message when the user cannot write", () => {
    useQmPermissionsForCourseMock.mockReturnValue({
      canCreateQuestion: false,
      hasCourseAccess: true,
      accessLoading: false,
    });
    render(<QuestionComposerPage />);
    expect(screen.getByText("You have read-only access to this course")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to questions" }));
    expect(navigateMock).toHaveBeenCalledWith("/courses/5?tab=questions");
  });

  it("shows a skeleton while the source question is loading (edit mode)", () => {
    routeParams.current = { courseId: "5", questionId: "42" };
    questionService.getQuestion.mockReturnValue(new Promise(() => {}));
    render(<QuestionComposerPage />);
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("shows a source-load error (edit mode)", async () => {
    routeParams.current = { courseId: "5", questionId: "42" };
    questionService.getQuestion.mockRejectedValue({
      response: { data: { error: "question gone" } },
    });
    render(<QuestionComposerPage />);
    expect(await screen.findByText("question gone")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to questions" }));
    expect(navigateMock).toHaveBeenCalledWith("/courses/5?tab=questions");
  });
});

describe("QuestionComposerPage create mode", () => {
  it("keeps draft creation available while disabling review and sharing for a TA", async () => {
    useQmPermissionsForCourseMock.mockReturnValue({
      canApproveVariant: false,
      canCreateQuestion: true,
      hasCourseAccess: true,
      accessLoading: false,
    });
    render(<QuestionComposerPage />);
    await screen.findByText("New question");

    expect(screen.getByRole("checkbox", { name: /^mark as reviewed/i })).toBeDisabled();
    expect(screen.getByTestId("share-with-extensions")).toBeDisabled();
    expect(screen.getByRole("button", { name: /save question/i })).toBeEnabled();
  });

  it("renders the composer shell with the create title", async () => {
    render(<QuestionComposerPage />);
    expect(await screen.findByText("New question")).toBeInTheDocument();
    expect(screen.getByTestId("type-selector")).toBeInTheDocument();
    await waitFor(() => expect(courseService.getCourseTopics).toHaveBeenCalledWith(5));
  });

  it("shows validation errors when saving an empty form", async () => {
    render(<QuestionComposerPage />);
    await screen.findByText("New question");
    fireEvent.click(screen.getByRole("button", { name: /save question/i }));
    expect(await screen.findByText("Question text is required.")).toBeInTheDocument();
    expect(questionService.createQuestion).not.toHaveBeenCalled();
  });

  it("requires at least 2 MCQ choices with a marked answer", async () => {
    render(<QuestionComposerPage />);
    await screen.findByText("New question");
    fireEvent.click(screen.getByText("set-text"));
    fireEvent.click(screen.getByText("set-primary-topic"));
    fireEvent.click(screen.getByRole("button", { name: /save question/i }));
    expect(await screen.findByText("Add at least 2 choices with text.")).toBeInTheDocument();
  });

  it("creates a question + variant on valid save", async () => {
    questionService.createQuestion.mockResolvedValue({ id: 99 });
    questionService.createVariant.mockResolvedValue({ id: 1 });
    render(<QuestionComposerPage />);
    await screen.findByText("New question");
    fireEvent.click(screen.getByText("set-text"));
    fireEvent.click(screen.getByText("set-choices"));
    fireEvent.click(screen.getByText("set-answer"));
    fireEvent.click(screen.getByText("set-primary-topic"));
    fireEvent.click(screen.getByRole("button", { name: /save question/i }));
    await waitFor(() => expect(questionService.createQuestion).toHaveBeenCalled());
    await waitFor(() =>
      expect(questionService.createVariant).toHaveBeenCalledWith(
        99,
        expect.objectContaining({ isDraft: true }),
      ),
    );
    expect(navigateMock).toHaveBeenCalledWith("/courses/5?tab=questions");
  });

  it("marks the created variant reviewed when the checkbox is checked", async () => {
    questionService.createQuestion.mockResolvedValue({ id: 99 });
    questionService.createVariant.mockResolvedValue({ id: 1 });
    render(<QuestionComposerPage />);
    await screen.findByText("New question");
    fireEvent.click(screen.getByText("set-text"));
    fireEvent.click(screen.getByText("set-choices"));
    fireEvent.click(screen.getByText("set-answer"));
    fireEvent.click(screen.getByText("set-primary-topic"));
    // The sharing label also says "mark as reviewed first", so anchor the match.
    fireEvent.click(screen.getByRole("checkbox", { name: /^mark as reviewed/i }));
    fireEvent.click(screen.getByRole("button", { name: /save question/i }));
    await waitFor(() =>
      expect(questionService.createVariant).toHaveBeenCalledWith(
        99,
        expect.objectContaining({ isDraft: false, shareWithExtensions: false }),
      ),
    );
  });

  it("gates extension sharing on the reviewed checkbox and clears it when unreviewed", async () => {
    questionService.createQuestion.mockResolvedValue({ id: 99 });
    questionService.createVariant.mockResolvedValue({ id: 1 });
    render(<QuestionComposerPage />);
    await screen.findByText("New question");

    const reviewed = screen.getByRole("checkbox", { name: /^mark as reviewed/i });
    const share = screen.getByTestId("share-with-extensions");
    expect(share).toBeDisabled();

    fireEvent.click(reviewed);
    expect(share).not.toBeDisabled();
    fireEvent.click(share);
    expect(share).toBeChecked();

    // Sharing only takes effect on approval, so dropping the review drops it (#1555).
    fireEvent.click(reviewed);
    expect(share).not.toBeChecked();
    expect(share).toBeDisabled();
  });

  it("submits the sharing flag for a reviewed variant", async () => {
    questionService.createQuestion.mockResolvedValue({ id: 99 });
    questionService.createVariant.mockResolvedValue({ id: 1 });
    render(<QuestionComposerPage />);
    await screen.findByText("New question");
    fireEvent.click(screen.getByText("set-text"));
    fireEvent.click(screen.getByText("set-choices"));
    fireEvent.click(screen.getByText("set-answer"));
    fireEvent.click(screen.getByText("set-primary-topic"));
    fireEvent.click(screen.getByRole("checkbox", { name: /^mark as reviewed/i }));
    fireEvent.click(screen.getByTestId("share-with-extensions"));
    fireEvent.click(screen.getByRole("button", { name: /save question/i }));
    await waitFor(() =>
      expect(questionService.createVariant).toHaveBeenCalledWith(
        99,
        expect.objectContaining({ isDraft: false, shareWithExtensions: true }),
      ),
    );
  });

  it("submits a draft without sharing when approval permission changes before save", async () => {
    questionService.createQuestion.mockResolvedValue({ id: 99 });
    questionService.createVariant.mockResolvedValue({ id: 1 });
    const view = render(<QuestionComposerPage />);
    await screen.findByText("New question");
    fireEvent.click(screen.getByText("set-text"));
    fireEvent.click(screen.getByText("set-choices"));
    fireEvent.click(screen.getByText("set-answer"));
    fireEvent.click(screen.getByText("set-primary-topic"));
    fireEvent.click(screen.getByRole("checkbox", { name: /^mark as reviewed/i }));
    fireEvent.click(screen.getByTestId("share-with-extensions"));

    useQmPermissionsForCourseMock.mockReturnValue({
      canApproveVariant: false,
      canCreateQuestion: true,
      hasCourseAccess: true,
      accessLoading: false,
    });
    view.rerender(<QuestionComposerPage />);
    fireEvent.click(screen.getByRole("button", { name: /save question/i }));

    await waitFor(() =>
      expect(questionService.createVariant).toHaveBeenCalledWith(
        99,
        expect.objectContaining({ isDraft: true, shareWithExtensions: false }),
      ),
    );
  });

  it("reports a save failure, translating the VARIANT_LOCKED code", async () => {
    questionService.createQuestion.mockRejectedValue({
      response: { data: { error: "VARIANT_LOCKED" } },
    });
    render(<QuestionComposerPage />);
    await screen.findByText("New question");
    fireEvent.click(screen.getByText("set-text"));
    fireEvent.click(screen.getByText("set-choices"));
    fireEvent.click(screen.getByText("set-answer"));
    fireEvent.click(screen.getByText("set-primary-topic"));
    fireEvent.click(screen.getByRole("button", { name: /save question/i }));
    expect(await screen.findByText(/approved and locked/i)).toBeInTheDocument();
    expect(toastFn.error).toHaveBeenCalled();
  });

  it("switches question type via the selector", async () => {
    render(<QuestionComposerPage />);
    await screen.findByText("New question");
    fireEvent.click(screen.getByText("set-type-sa"));
    // SA no longer requires MCQ choices; only text + topic needed.
    fireEvent.click(screen.getByText("set-text"));
    fireEvent.click(screen.getByText("set-primary-topic"));
    questionService.createQuestion.mockResolvedValue({ id: 5 });
    questionService.createVariant.mockResolvedValue({ id: 1 });
    fireEvent.click(screen.getByRole("button", { name: /save question/i }));
    await waitFor(() =>
      expect(questionService.createQuestion).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SA" }),
      ),
    );
  });

  it("saves the description and clears the output panel", async () => {
    render(<QuestionComposerPage />);
    await screen.findByText("New question");
    fireEvent.click(screen.getByText("set-description"));
    fireEvent.click(screen.getByText("set-text"));
    fireEvent.click(screen.getByText("clear"));
    // Clearing resets text, so saving again should fail validation again.
    fireEvent.click(screen.getByRole("button", { name: /save question/i }));
    expect(await screen.findByText("Question text is required.")).toBeInTheDocument();
  });
});

describe("QuestionComposerPage variant mode", () => {
  beforeEach(() => {
    searchParamsBox.current = new URLSearchParams("variantOf=7");
    questionService.getQuestion.mockResolvedValue({
      id: 7,
      type: "MCQ",
      description: "Base question",
      primaryTopicId: "t1",
      variants: [
        {
          id: 70,
          questionText: "Base text",
          difficulty: "easy",
          answer: "A",
          choices: [{ letter: "A", text: "x" }],
          referenceId: null,
        },
      ],
    });
  });

  it("renders the variant title and inherited type", async () => {
    render(<QuestionComposerPage />);
    expect(await screen.findByText("New variant")).toBeInTheDocument();
    expect(screen.getByText(/inherited from the original question/i)).toBeInTheDocument();
  });

  it("creates a variant referencing the source question", async () => {
    questionService.createVariant.mockResolvedValue({ id: 71 });
    render(<QuestionComposerPage />);
    await screen.findByText("New variant");
    fireEvent.click(screen.getByText("set-text"));
    fireEvent.click(screen.getByText("set-choices"));
    fireEvent.click(screen.getByText("set-answer"));
    fireEvent.click(screen.getByRole("button", { name: /add variant/i }));
    await waitFor(() =>
      expect(questionService.createVariant).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ referenceId: 70 }),
      ),
    );
    expect(navigateMock).toHaveBeenCalledWith("/courses/5?tab=questions");
  });
});

describe("QuestionComposerPage edit mode", () => {
  beforeEach(() => {
    routeParams.current = { courseId: "5", questionId: "7" };
  });

  it("reopens an approved variant as a draft on edit", async () => {
    questionService.getQuestion.mockResolvedValue({
      id: 7,
      type: "MCQ",
      description: "desc",
      primaryTopicId: "t1",
      variants: [
        {
          id: 70,
          questionText: "Base text",
          difficulty: "easy",
          answer: "A",
          choices: [
            { letter: "A", text: "x" },
            { letter: "B", text: "y" },
          ],
          isDraft: false,
        },
      ],
    });
    questionService.updateVariant.mockResolvedValue({});
    questionService.updateQuestion.mockResolvedValue({});
    render(<QuestionComposerPage />);
    expect(await screen.findByText("Edit question")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() =>
      expect(questionService.updateVariant).toHaveBeenCalledWith(
        70,
        expect.objectContaining({ isDraft: true }),
      ),
    );
    expect(toastFn).toHaveBeenCalledWith("Saved — reopened for review", expect.anything());
  });

  it("lists other variants when more than one exists", async () => {
    questionService.getQuestion.mockResolvedValue({
      id: 7,
      type: "MCQ",
      description: "desc",
      primaryTopicId: "t1",
      variants: [
        {
          id: 70,
          questionText: "Variant A",
          difficulty: "easy",
          answer: "A",
          choices: [
            { letter: "A", text: "x" },
            { letter: "B", text: "y" },
          ],
          isDraft: true,
        },
        { id: 71, questionText: "Variant B", difficulty: "hard", isDraft: true },
      ],
    });
    render(<QuestionComposerPage />);
    await screen.findByText("Edit question");
    expect(await screen.findByText("Other variants")).toBeInTheDocument();
    expect(screen.getByText("Variant B")).toBeInTheDocument();
  });
});

describe("QuestionComposerPage AI generation", () => {
  it("requires a topic prompt before generating", async () => {
    render(<QuestionComposerPage />);
    await screen.findByText("New question");
    fireEvent.click(screen.getByText("generate"));
    expect(await screen.findByText(/Enter a topic or prompt/i)).toBeInTheDocument();
    expect(eduaiService.generateQuestions).not.toHaveBeenCalled();
  });

  it("generates a question and fills the form", async () => {
    eduaiService.generateQuestions.mockResolvedValue({
      data: {
        questions: [
          {
            type: "MCQ",
            difficulty: "hard",
            content: "Generated question?",
            choices: [
              { letter: "A", text: "x" },
              { letter: "B", text: "y" },
            ],
            answer: "A",
            primary_topic_id: "t1",
          },
        ],
      },
    });
    render(<QuestionComposerPage />);
    await screen.findByText("New question");
    fireEvent.click(screen.getByText("set-prompt"));
    fireEvent.click(screen.getByText("generate"));
    await waitFor(() => expect(eduaiService.generateQuestions).toHaveBeenCalled());
    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith("Question generated", expect.anything()),
    );
  });

  it("surfaces a generation failure with error details", async () => {
    eduaiService.generateQuestions.mockRejectedValue({
      response: { data: { aiErrorReason: "quota exceeded" } },
    });
    render(<QuestionComposerPage />);
    await screen.findByText("New question");
    fireEvent.click(screen.getByText("set-prompt"));
    fireEvent.click(screen.getByText("generate"));
    expect(await screen.findByText("quota exceeded")).toBeInTheDocument();
    expect(toastFn.error).toHaveBeenCalled();
  });

  it("saves a provider API key", async () => {
    render(<QuestionComposerPage />);
    await screen.findByText("New question");
    fireEvent.click(screen.getByText("set-key"));
    fireEvent.click(screen.getByText("save-key"));
    await waitFor(() => expect(apiKeyStorage.setApiKey).toHaveBeenCalledWith("openai", "sk-test"));
    await waitFor(() => expect(screen.getByTestId("api-key-state")).toHaveTextContent("saved"));
  });
});

const mcq = (content: string) => ({
  type: "MCQ",
  difficulty: "medium",
  content,
  choices: [
    { letter: "A", text: "x" },
    { letter: "B", text: "y" },
  ],
  answer: "A",
  primary_topic_id: "t1",
});

describe("QuestionComposerPage batch generation (#1973)", () => {
  async function generateBatch(contents: string[], count = 3) {
    eduaiService.generateQuestions.mockResolvedValue({ data: { questions: contents.map(mcq) } });
    render(<QuestionComposerPage />);
    await screen.findByText("New question");
    fireEvent.click(screen.getByText("set-prompt"));
    if (count === 3) fireEvent.click(screen.getByText("set-count-3"));
    fireEvent.click(screen.getByText("generate"));
    await waitFor(() => expect(eduaiService.generateQuestions).toHaveBeenCalled());
  }

  it("keeps N = 1 requests and labels unchanged", async () => {
    await generateBatch(["Only?"], 1);
    expect(eduaiService.generateQuestions).toHaveBeenCalledWith(
      expect.objectContaining({
        numQuestions: 1,
        difficultyDistribution: { easy: 0, medium: 1, hard: 0 },
      }),
    );
    await waitFor(() => expect(screen.getByTestId("question-text")).toHaveTextContent("Only?"));
    expect(screen.queryByRole("navigation", { name: "Generated drafts" })).toBeNull();
    expect(screen.getByRole("button", { name: /save question/i })).toBeInTheDocument();
  });

  it("requests N questions with a matching difficulty count and loads draft 1", async () => {
    await generateBatch(["Q1?", "Q2?", "Q3?"]);
    expect(eduaiService.generateQuestions).toHaveBeenCalledWith(
      expect.objectContaining({
        numQuestions: 3,
        difficultyDistribution: { easy: 0, medium: 3, hard: 0 },
      }),
    );
    expect(await screen.findByText("Draft 1 of 3")).toBeInTheDocument();
    expect(screen.getByTestId("question-text")).toHaveTextContent("Q1?");
  });

  it("only offers the count control in create mode", async () => {
    render(<QuestionComposerPage />);
    await screen.findByText("New question");
    expect(screen.getByTestId("has-count")).toHaveTextContent("true");
  });

  it("saves each draft, advances, and returns to the bank after the last", async () => {
    questionService.createQuestion.mockResolvedValue({ id: 99 });
    questionService.createVariant.mockResolvedValue({ id: 1 });
    await generateBatch(["Q1?", "Q2?", "Q3?"]);
    await screen.findByText("Draft 1 of 3");
    fireEvent.click(screen.getByRole("button", { name: /save & next/i }));
    expect(await screen.findByText("Draft 2 of 3")).toBeInTheDocument();
    expect(screen.getByTestId("question-text")).toHaveTextContent("Q2?");
    expect(navigateMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /discard draft/i }));
    expect(await screen.findByText("Draft 3 of 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save & next/i }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/courses/5?tab=questions"));
    expect(questionService.createQuestion).toHaveBeenCalledTimes(2);
    expect(toastFn).toHaveBeenCalledWith("Saved 2 of 3 questions", expect.anything());
  });

  it("keeps edits when switching between drafts", async () => {
    await generateBatch(["Q1?", "Q2?", "Q3?"]);
    await screen.findByText("Draft 1 of 3");
    fireEvent.click(screen.getByText("set-text"));
    fireEvent.click(screen.getByRole("button", { name: "Draft 2, pending" }));
    expect(screen.getByTestId("question-text")).toHaveTextContent("Q2?");
    fireEvent.click(screen.getByRole("button", { name: "Draft 1, pending" }));
    expect(screen.getByTestId("question-text")).toHaveTextContent("What is 2+2?");
  });

  it("stays on a draft whose save fails", async () => {
    questionService.createQuestion.mockRejectedValue(new Error("boom"));
    await generateBatch(["Q1?", "Q2?", "Q3?"]);
    await screen.findByText("Draft 1 of 3");
    fireEvent.click(screen.getByRole("button", { name: /save & next/i }));
    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Draft 1, current" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Draft 2, pending" })).toBeEnabled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("handles a partial result", async () => {
    await generateBatch(["Q1?", "Q2?"]);
    expect(await screen.findByText("Draft 1 of 2")).toBeInTheDocument();
    expect(toastFn).toHaveBeenCalledWith("Generated 2 of 3 questions", expect.anything());
  });

  it("treats a single result from a batch like N = 1", async () => {
    await generateBatch(["Q1?"]);
    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith("Generated 1 of 3 questions", expect.anything()),
    );
    expect(screen.queryByRole("navigation", { name: "Generated drafts" })).toBeNull();
    expect(screen.getByRole("button", { name: /save question/i })).toBeInTheDocument();
  });

  it("confirms before cancelling or regenerating with pending drafts", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await generateBatch(["Q1?", "Q2?", "Q3?"]);
    await screen.findByText("Draft 1 of 3");
    // The header back arrow and the footer button are both named "Cancel".
    for (const cancel of screen.getAllByRole("button", { name: /^cancel$/i })) {
      fireEvent.click(cancel);
    }
    expect(navigateMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("generate"));
    expect(eduaiService.generateQuestions).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Draft 1 of 3")).toBeInTheDocument();
    expect(confirmSpy).toHaveBeenCalledTimes(3);
    confirmSpy.mockRestore();
  });
});
