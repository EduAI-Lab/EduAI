/**
 * Unit tests for QuestionComposerPage (#1544). Hooks, services, and heavy child
 * components are mocked so we exercise the page's own logic — mode derivation,
 * gate states, the create/variant wizard flow, validation, save flows
 * (create/variant/edit), and AI generation — without depending on the real
 * design system or network calls. The wizard's layout pieces (stepper, footer)
 * render for real; its step bodies are mocked.
 *
 * `vi.mock` factories are hoisted above every other top-level statement
 * (including imports), so anything referenced inside one is created via
 * `vi.hoisted` to avoid a TDZ ReferenceError.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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
      status: "ok" as "ok" | "error",
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
      checkQuestionTopicChange: vi.fn(),
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
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
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
  HelpHint: ({ title }: any) => <button type="button" aria-label={`About ${title}`} />,
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
  Card: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>,
  CardContent: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h2>{children}</h2>,
  Label: ({ children, htmlFor }: any) => <label htmlFor={htmlFor}>{children}</label>,
  Separator: () => <hr />,
  Skeleton: () => <div data-testid="skeleton" />,
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
}));

vi.mock("@/components/questions/QuestionAIControls", () => ({
  isUbcModelId: (id: string) => id.startsWith("ollama") || id.startsWith("vllm"),
  QuestionAIControls: (props: any) => (
    <div data-testid="ai-controls">
      <button onClick={props.onGenerate}>generate</button>
      <button onClick={() => props.onChange("generationPrompt", "a great prompt")}>
        set-prompt
      </button>
    </div>
  ),
}));

vi.mock("@/components/questions/QuestionOutputPanel", () => ({
  QuestionOutputPanel: (props: any) => (
    <div data-testid="output-panel" data-mcq-layout={props.mcqLayout}>
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

vi.mock("@/components/composer/wizard/WizardMethodStep", () => ({
  WizardMethodStep: (props: any) => (
    <div data-testid="method-step" data-mode={props.mode}>
      <span data-testid="method-value">{props.value ?? "none"}</span>
      <button onClick={() => props.onChange("manual")}>choose-manual</button>
      <button onClick={() => props.onChange("ai")}>choose-ai</button>
      <span data-testid="ai-status-note">{props.aiStatusNote ?? ""}</span>
    </div>
  ),
}));

vi.mock("@/components/composer/wizard/WizardDetailsStep", () => ({
  WizardDetailsStep: (props: any) => (
    <div data-testid="details-step" data-mode={props.mode}>
      <span data-testid="details-type">{props.value.questionType}</span>
      <span data-testid="details-difficulty">{props.value.difficulty}</span>
      <span data-testid="original-difficulty">{props.original?.difficulty ?? ""}</span>
      <span data-testid="primary-topic-error">{props.topicError ?? ""}</span>
      <button onClick={() => props.onChange({ questionType: "SA" })}>set-type-sa</button>
      <button onClick={() => props.onChange({ primaryTopicId: "t1" })}>set-primary-topic</button>
      <button onClick={() => props.onChange({ difficulty: "hard" })}>set-difficulty-hard</button>
      <button onClick={() => props.onChange({ description: "a description" })}>
        set-description
      </button>
    </div>
  ),
}));

vi.mock("@/components/composer/wizard/WizardDetailsSummary", () => ({
  WizardDetailsSummary: (props: any) => (
    <div data-testid="details-summary">
      {[props.format, props.topic, props.difficulty, props.thinkingSkill].join(" · ")}
      <button onClick={props.onEdit}>Edit details</button>
    </div>
  ),
}));

vi.mock("@/components/composer/wizard/WizardAIPanel", () => ({
  WizardAIPanel: (props: any) => (
    <div data-testid="ai-panel" data-mode={props.mode}>
      <button onClick={props.onGenerate}>{props.hasGenerated ? "Regenerate" : "Generate"}</button>
      <button onClick={() => props.onPromptChange("a great prompt")}>set-prompt</button>
      <button onClick={() => props.onQuestionCountChange(3)}>set-count-3</button>
      <button onClick={() => props.onProviderApiKeyChange("sk-test")}>set-key</button>
      <button onClick={props.onSaveProviderApiKey}>save-key</button>
      <span data-testid="api-key-state">{props.apiKeySaveState}</span>
      <span data-testid="ai-disabled">{String(Boolean(props.disabled))}</span>
    </div>
  ),
}));

vi.mock("@/components/composer/wizard/WizardDraftList", () => ({
  WizardDraftList: (props: any) => (
    <ol aria-label="Generated drafts">
      {props.drafts.map((d: any, i: number) => (
        <li key={i} data-testid={`draft-${i + 1}`} data-keep={String(d.keep)}>
          <span>{d.questionText}</span>
          <button onClick={() => props.onKeepChange(i, !d.keep)}>toggle-keep-{i + 1}</button>
          <button onClick={() => props.onEdit(i)}>edit-{i + 1}</button>
          <button onClick={() => props.onRegenerate(i)}>regenerate-{i + 1}</button>
          <span>{props.errors?.[i] ?? ""}</span>
        </li>
      ))}
    </ol>
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

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

/** Picks a start method on step 1 and continues through step 2 to step 3. */
async function goToStep3(method: "manual" | "ai", title = "New question") {
  await screen.findByText(title);
  fireEvent.click(screen.getByText(`choose-${method}`));
  click("Continue");
  await screen.findByTestId("details-step");
  click("Continue");
}

/** Selects "Save as: Reviewed" in the wizard footer. */
const chooseReviewed = () => fireEvent.click(screen.getByRole("radio", { name: "Reviewed" }));

/** Fills a valid MCQ in the manual editor (topic t1 is defaulted from the course topics). */
function fillValidMcq() {
  fireEvent.click(screen.getByText("set-text"));
  fireEvent.click(screen.getByText("set-choices"));
  fireEvent.click(screen.getByText("set-answer"));
}

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

describe("QuestionComposerPage wizard navigation", () => {
  it("starts on step 1 with Continue disabled until a start method is picked", async () => {
    render(<QuestionComposerPage />);
    expect(await screen.findByText("New question")).toBeInTheDocument();
    expect(screen.getByTestId("method-step")).toHaveAttribute("data-mode", "question");
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.click(screen.getByText("choose-manual"));
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    await waitFor(() => expect(courseService.getCourseTopics).toHaveBeenCalledWith(5));
  });

  it("labels step 3 by the chosen path", async () => {
    render(<QuestionComposerPage />);
    await screen.findByText("New question");
    const steps = screen.getByRole("navigation", { name: "Steps" });
    expect(within(steps).getByText("Write question")).toBeInTheDocument();
    fireEvent.click(screen.getByText("choose-ai"));
    expect(within(steps).getByText("Generate & review")).toBeInTheDocument();
  });

  it("lets completed steps be revisited but keeps future steps disabled", async () => {
    render(<QuestionComposerPage />);
    await goToStep3("manual");
    const steps = screen.getByRole("navigation", { name: "Steps" });
    const stepButton = (label: string) => within(steps).getByText(label).closest("button")!;
    expect(stepButton("Write question")).toHaveAttribute("aria-current", "step");
    fireEvent.click(stepButton("Details"));
    expect(screen.getByTestId("details-step")).toBeInTheDocument();
    expect(stepButton("Write question")).toBeDisabled();
    fireEvent.click(stepButton("How to start"));
    expect(screen.getByTestId("method-value")).toHaveTextContent("manual");
  });

  it("keeps entered fields when going Back and forward again", async () => {
    render(<QuestionComposerPage />);
    await goToStep3("manual");
    fireEvent.click(screen.getByText("set-text"));
    click("Back");
    fireEvent.click(screen.getByText("set-difficulty-hard"));
    click("Back");
    click("Continue");
    expect(screen.getByTestId("details-difficulty")).toHaveTextContent("hard");
    click("Continue");
    expect(screen.getByTestId("question-text")).toHaveTextContent("What is 2+2?");
  });

  it("shows the details summary on step 3 and jumps to step 2 from Edit details", async () => {
    render(<QuestionComposerPage />);
    await goToStep3("manual");
    await waitFor(() =>
      expect(screen.getByTestId("details-summary")).toHaveTextContent(
        "Multiple choice · Topic 1 · Medium · Recall",
      ),
    );
    expect(screen.getByTestId("output-panel")).toHaveAttribute("data-mcq-layout", "radios");
    click("Edit details");
    expect(screen.getByTestId("details-step")).toBeInTheDocument();
  });

  it("shows the UBC-offline note only when the UBC model is selected and offline", async () => {
    eduaiStatusMock.status = "error";
    eduaiService.listModels.mockResolvedValue([]);
    render(<QuestionComposerPage />);
    await screen.findByText("New question");
    expect(screen.getByTestId("ai-status-note")).toHaveTextContent(/UBC model offline/);
  });

  it("omits the UBC-offline note while the service is up", async () => {
    eduaiService.listModels.mockResolvedValue([]);
    render(<QuestionComposerPage />);
    await screen.findByText("New question");
    expect(screen.getByTestId("ai-status-note")).toHaveTextContent("");
  });
});

describe("QuestionComposerPage create mode (manual path)", () => {
  it("keeps draft creation available while disabling review and sharing for a TA", async () => {
    useQmPermissionsForCourseMock.mockReturnValue({
      canApproveVariant: false,
      canCreateQuestion: true,
      hasCourseAccess: true,
      accessLoading: false,
    });
    render(<QuestionComposerPage />);
    await goToStep3("manual");

    expect(screen.getByRole("radio", { name: "Reviewed" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Draft" })).toBeChecked();
    expect(screen.getByTestId("share-with-extensions")).toBeDisabled();
    expect(screen.getByRole("button", { name: /save question/i })).toBeEnabled();
  });

  it("shows validation errors when saving an empty form", async () => {
    render(<QuestionComposerPage />);
    await goToStep3("manual");
    click(/save question/i);
    expect(await screen.findByText("Question text is required.")).toBeInTheDocument();
    expect(questionService.createQuestion).not.toHaveBeenCalled();
  });

  it("requires at least 2 MCQ choices with a marked answer", async () => {
    render(<QuestionComposerPage />);
    await goToStep3("manual");
    fireEvent.click(screen.getByText("set-text"));
    click(/save question/i);
    expect(await screen.findByText("Add at least 2 choices with text.")).toBeInTheDocument();
  });

  it("returns to Details with the topic error when no primary topic is set", async () => {
    courseService.getCourseTopics.mockResolvedValue([]);
    render(<QuestionComposerPage />);
    await goToStep3("manual");
    fillValidMcq();
    click(/save question/i);
    expect(await screen.findByTestId("details-step")).toBeInTheDocument();
    expect(screen.getByTestId("primary-topic-error")).toHaveTextContent("Select a primary topic.");
    expect(questionService.createQuestion).not.toHaveBeenCalled();
  });

  it("creates a question + variant as a draft on valid save", async () => {
    questionService.createQuestion.mockResolvedValue({ id: 99 });
    questionService.createVariant.mockResolvedValue({ id: 1 });
    render(<QuestionComposerPage />);
    await goToStep3("manual");
    fillValidMcq();
    click(/save question/i);
    await waitFor(() =>
      expect(questionService.createQuestion).toHaveBeenCalledWith(
        expect.objectContaining({ primaryTopicId: "t1", type: "MCQ", courseId: 5 }),
      ),
    );
    await waitFor(() =>
      expect(questionService.createVariant).toHaveBeenCalledWith(
        99,
        expect.objectContaining({ isDraft: true, isAiGenerated: false, answer: "A" }),
      ),
    );
    expect(toastFn).toHaveBeenCalledWith("Question saved as a draft.");
    expect(navigateMock).toHaveBeenCalledWith("/courses/5?tab=questions");
  });

  it("marks the created variant reviewed when Save as Reviewed is chosen", async () => {
    questionService.createQuestion.mockResolvedValue({ id: 99 });
    questionService.createVariant.mockResolvedValue({ id: 1 });
    render(<QuestionComposerPage />);
    await goToStep3("manual");
    fillValidMcq();
    chooseReviewed();
    click(/save question/i);
    await waitFor(() =>
      expect(questionService.createVariant).toHaveBeenCalledWith(
        99,
        expect.objectContaining({ isDraft: false, shareWithExtensions: false }),
      ),
    );
    expect(toastFn).toHaveBeenCalledWith("Question saved as reviewed.");
  });

  it("gates sharing on Reviewed and clears it when switched back to Draft", async () => {
    render(<QuestionComposerPage />);
    await goToStep3("manual");

    const share = screen.getByTestId("share-with-extensions");
    expect(share).toBeDisabled();

    chooseReviewed();
    expect(share).not.toBeDisabled();
    fireEvent.click(share);
    expect(share).toBeChecked();

    // Sharing only takes effect on approval, so dropping the review drops it (#1555).
    fireEvent.click(screen.getByRole("radio", { name: "Draft" }));
    expect(share).not.toBeChecked();
    expect(share).toBeDisabled();
  });

  it("submits the sharing flag for a reviewed variant", async () => {
    questionService.createQuestion.mockResolvedValue({ id: 99 });
    questionService.createVariant.mockResolvedValue({ id: 1 });
    render(<QuestionComposerPage />);
    await goToStep3("manual");
    fillValidMcq();
    chooseReviewed();
    fireEvent.click(screen.getByTestId("share-with-extensions"));
    click(/save question/i);
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
    await goToStep3("manual");
    fillValidMcq();
    chooseReviewed();
    fireEvent.click(screen.getByTestId("share-with-extensions"));

    useQmPermissionsForCourseMock.mockReturnValue({
      canApproveVariant: false,
      canCreateQuestion: true,
      hasCourseAccess: true,
      accessLoading: false,
    });
    view.rerender(<QuestionComposerPage />);
    click(/save question/i);

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
    await goToStep3("manual");
    fillValidMcq();
    click(/save question/i);
    expect(await screen.findByText(/approved and locked/i)).toBeInTheDocument();
    expect(toastFn.error).toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("saves a short-answer question chosen on the Details step", async () => {
    questionService.createQuestion.mockResolvedValue({ id: 5 });
    questionService.createVariant.mockResolvedValue({ id: 1 });
    render(<QuestionComposerPage />);
    await screen.findByText("New question");
    fireEvent.click(screen.getByText("choose-manual"));
    click("Continue");
    fireEvent.click(screen.getByText("set-type-sa"));
    fireEvent.click(screen.getByText("set-description"));
    click("Continue");
    // SA no longer requires MCQ choices; only text + topic needed.
    fireEvent.click(screen.getByText("set-text"));
    click(/save question/i);
    await waitFor(() =>
      expect(questionService.createQuestion).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SA", description: "a description" }),
      ),
    );
  });

  it("clears the editor content", async () => {
    render(<QuestionComposerPage />);
    await goToStep3("manual");
    fireEvent.click(screen.getByText("set-text"));
    fireEvent.click(screen.getByText("clear"));
    // Clearing resets text, so saving again should fail validation again.
    click(/save question/i);
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
          reasoningLevel: "analytical",
          answer: "A",
          choices: [
            { letter: "A", text: "x" },
            { letter: "B", text: "y" },
          ],
          referenceId: null,
        },
      ],
    });
  });

  it("shows the original question above the stepper", async () => {
    render(<QuestionComposerPage />);
    const original = await screen.findByTestId("variant-original");
    expect(screen.getByText("New variant")).toBeInTheDocument();
    expect(original).toHaveTextContent("Variant of");
    expect(original).toHaveTextContent("Base text");
    await waitFor(() =>
      expect(original).toHaveTextContent("Multiple choice · Topic 1 · Easy · Analyze"),
    );
    expect(screen.getByTestId("method-step")).toHaveAttribute("data-mode", "variant");
  });

  it("passes the original's details to step 2", async () => {
    render(<QuestionComposerPage />);
    await screen.findByText("New variant");
    fireEvent.click(screen.getByText("choose-manual"));
    click("Continue");
    expect(screen.getByTestId("details-step")).toHaveAttribute("data-mode", "variant");
    expect(screen.getByTestId("original-difficulty")).toHaveTextContent("easy");
    expect(screen.getByTestId("details-difficulty")).toHaveTextContent("easy");
  });

  it("starts from a copy of the original and creates a variant referencing it", async () => {
    questionService.createVariant.mockResolvedValue({ id: 71 });
    render(<QuestionComposerPage />);
    await goToStep3("manual", "New variant");
    expect(screen.getByTestId("question-text")).toHaveTextContent("Base text");
    click(/add variant/i);
    await waitFor(() =>
      expect(questionService.createVariant).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          referenceId: 70,
          questionText: "Base text",
          isAiGenerated: false,
        }),
      ),
    );
    expect(toastFn).toHaveBeenCalledWith("Variant saved as a draft.");
    expect(navigateMock).toHaveBeenCalledWith("/courses/5?tab=questions");
  });

  it("generates a single AI variant and saves it", async () => {
    eduaiService.generateQuestions.mockResolvedValue({
      data: {
        questions: [
          {
            type: "MCQ",
            content: "Harder variant?",
            choices: [
              { letter: "A", text: "p" },
              { letter: "B", text: "q" },
            ],
            answer: "B",
          },
        ],
      },
    });
    questionService.createVariant.mockResolvedValue({ id: 72 });
    render(<QuestionComposerPage />);
    await goToStep3("ai", "New variant");
    expect(screen.getByTestId("ai-panel")).toHaveAttribute("data-mode", "variant");
    fireEvent.click(screen.getByText("set-count-3"));
    fireEvent.click(screen.getByText("set-prompt"));
    click("Generate");
    expect(await screen.findByText("Harder variant?")).toBeInTheDocument();
    expect(eduaiService.generateQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ numQuestions: 1, mcqRequiredChoiceCount: 2 }),
    );
    click(/add variant/i);
    await waitFor(() =>
      expect(questionService.createVariant).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ questionText: "Harder variant?", isAiGenerated: true }),
      ),
    );
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

  const approvedOnTopicT0 = {
    id: 7,
    type: "MCQ",
    description: "desc",
    primaryTopicId: "t0",
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
  };

  it("checks a topic change before reopening an approved variant (#1974)", async () => {
    questionService.getQuestion.mockResolvedValue(approvedOnTopicT0);
    questionService.checkQuestionTopicChange.mockResolvedValue(undefined);
    questionService.updateVariant.mockResolvedValue({});
    questionService.updateQuestion.mockResolvedValue({});
    render(<QuestionComposerPage />);
    await screen.findByText("Edit question");
    fireEvent.click(screen.getByText("set-primary-topic"));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() =>
      expect(questionService.updateQuestion).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ primaryTopicId: "t1" }),
      ),
    );
    expect(questionService.checkQuestionTopicChange).toHaveBeenCalledWith(7, "t1");
    expect(questionService.checkQuestionTopicChange.mock.invocationCallOrder[0]).toBeLessThan(
      questionService.updateVariant.mock.invocationCallOrder[0],
    );
  });

  it("leaves an approved variant untouched when the topic change is refused (#1974)", async () => {
    questionService.getQuestion.mockResolvedValue(approvedOnTopicT0);
    questionService.checkQuestionTopicChange.mockRejectedValue({
      response: {
        data: { error: "This question is in an assessment that doesn't cover the new topic" },
      },
    });
    render(<QuestionComposerPage />);
    await screen.findByText("Edit question");
    fireEvent.click(screen.getByText("set-primary-topic"));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() =>
      expect(toastFn.error).toHaveBeenCalledWith("Save failed", {
        description: "This question is in an assessment that doesn't cover the new topic",
      }),
    );
    expect(questionService.updateVariant).not.toHaveBeenCalled();
    expect(questionService.updateQuestion).not.toHaveBeenCalled();
  });

  it("skips the topic check when the topic is unchanged", async () => {
    questionService.getQuestion.mockResolvedValue({ ...approvedOnTopicT0, primaryTopicId: "t1" });
    questionService.updateVariant.mockResolvedValue({});
    questionService.updateQuestion.mockResolvedValue({});
    render(<QuestionComposerPage />);
    await screen.findByText("Edit question");
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(questionService.updateQuestion).toHaveBeenCalled());
    expect(questionService.checkQuestionTopicChange).not.toHaveBeenCalled();
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

describe("QuestionComposerPage AI generation", () => {
  it("requires a topic prompt before generating", async () => {
    render(<QuestionComposerPage />);
    await goToStep3("ai");
    click("Generate");
    expect(await screen.findByText(/Enter a topic or prompt/i)).toBeInTheDocument();
    expect(eduaiService.generateQuestions).not.toHaveBeenCalled();
  });

  it("generates a question and lists it as a draft", async () => {
    eduaiService.generateQuestions.mockResolvedValue({ data: { questions: [mcq("Generated?")] } });
    render(<QuestionComposerPage />);
    await goToStep3("ai");
    fireEvent.click(screen.getByText("set-prompt"));
    click("Generate");
    expect(await screen.findByText("Generated?")).toBeInTheDocument();
    expect(toastFn).toHaveBeenCalledWith("Question generated", expect.anything());
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument();
  });

  it("surfaces a generation failure with error details", async () => {
    eduaiService.generateQuestions.mockRejectedValue({
      response: { data: { aiErrorReason: "quota exceeded" } },
    });
    render(<QuestionComposerPage />);
    await goToStep3("ai");
    fireEvent.click(screen.getByText("set-prompt"));
    click("Generate");
    expect(await screen.findByText("quota exceeded")).toBeInTheDocument();
    expect(toastFn.error).toHaveBeenCalled();
  });

  it("saves a provider API key", async () => {
    render(<QuestionComposerPage />);
    await goToStep3("ai");
    fireEvent.click(screen.getByText("set-key"));
    fireEvent.click(screen.getByText("save-key"));
    await waitFor(() => expect(apiKeyStorage.setApiKey).toHaveBeenCalledWith("openai", "sk-test"));
    await waitFor(() => expect(screen.getByTestId("api-key-state")).toHaveTextContent("saved"));
  });

  it("keeps Generate disabled until the course topics have loaded", async () => {
    let resolveTopics: (topics: Array<{ id: string; name: string }>) => void = () => {};
    courseService.getCourseTopics.mockReturnValue(
      new Promise((resolve) => {
        resolveTopics = resolve;
      }),
    );
    render(<QuestionComposerPage />);
    await goToStep3("ai");
    expect(screen.getByTestId("ai-disabled")).toHaveTextContent("true");
    resolveTopics([{ id: "t1", name: "Topic 1" }]);
    await waitFor(() => expect(screen.getByTestId("ai-disabled")).toHaveTextContent("false"));
  });
});

describe("QuestionComposerPage AI drafts (#1973)", () => {
  async function generateBatch(contents: string[], count = 3) {
    eduaiService.generateQuestions.mockResolvedValue({ data: { questions: contents.map(mcq) } });
    render(<QuestionComposerPage />);
    await goToStep3("ai");
    fireEvent.click(screen.getByText("set-prompt"));
    if (count === 3) fireEvent.click(screen.getByText("set-count-3"));
    click("Generate");
    await waitFor(() => expect(eduaiService.generateQuestions).toHaveBeenCalled());
    await screen.findByTestId("draft-1");
  }

  it("keeps Save disabled until something has been generated", async () => {
    render(<QuestionComposerPage />);
    await goToStep3("ai");
    expect(screen.getByRole("button", { name: /save question/i })).toBeDisabled();
  });

  it("requests one question by default", async () => {
    await generateBatch(["Only?"], 1);
    expect(eduaiService.generateQuestions).toHaveBeenCalledWith(
      expect.objectContaining({
        numQuestions: 1,
        difficultyDistribution: { easy: 0, medium: 1, hard: 0 },
      }),
    );
    expect(screen.getByRole("button", { name: /save question/i })).toBeEnabled();
  });

  it("requests N questions with a matching difficulty count and lists every draft", async () => {
    await generateBatch(["Q1?", "Q2?", "Q3?"]);
    expect(eduaiService.generateQuestions).toHaveBeenCalledWith(
      expect.objectContaining({
        numQuestions: 3,
        difficultyDistribution: { easy: 0, medium: 3, hard: 0 },
      }),
    );
    expect(screen.getByText("Q1?")).toBeInTheDocument();
    expect(screen.getByText("Q3?")).toBeInTheDocument();
    expect(screen.getByTestId("draft-2")).toHaveAttribute("data-keep", "true");
    expect(screen.getByRole("button", { name: "Save 3 questions" })).toBeEnabled();
  });

  it("saves only the kept drafts and returns to the bank", async () => {
    questionService.createQuestion.mockResolvedValue({ id: 99 });
    questionService.createVariant.mockResolvedValue({ id: 1 });
    await generateBatch(["Q1?", "Q2?", "Q3?"]);
    fireEvent.click(screen.getByText("toggle-keep-2"));
    expect(screen.getByTestId("draft-2")).toHaveAttribute("data-keep", "false");
    click("Save 2 questions");
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/courses/5?tab=questions"));
    expect(questionService.createQuestion).toHaveBeenCalledTimes(2);
    const savedTexts = questionService.createVariant.mock.calls.map(
      (c: any[]) => c[1].questionText,
    );
    expect(savedTexts).toEqual(["Q1?", "Q3?"]);
    expect(questionService.createVariant).toHaveBeenCalledWith(
      99,
      expect.objectContaining({ isAiGenerated: true, isDraft: true }),
    );
    expect(toastFn).toHaveBeenCalledWith("2 questions saved as drafts.");
  });

  it("disables Save when no draft is kept", async () => {
    await generateBatch(["Q1?"], 1);
    fireEvent.click(screen.getByText("toggle-keep-1"));
    expect(screen.getByRole("button", { name: /save question/i })).toBeDisabled();
  });

  it("edits a draft in the manual editor and keeps the edit", async () => {
    questionService.createQuestion.mockResolvedValue({ id: 99 });
    questionService.createVariant.mockResolvedValue({ id: 1 });
    await generateBatch(["Q1?", "Q2?"]);
    fireEvent.click(screen.getByText("edit-2"));
    expect(screen.getByText("Editing draft 2")).toBeInTheDocument();
    expect(screen.getByTestId("question-text")).toHaveTextContent("Q2?");
    fireEvent.click(screen.getByText("set-text"));
    click("Back to drafts");
    expect(screen.getByTestId("draft-2")).toHaveTextContent("What is 2+2?");
    expect(screen.getByTestId("draft-1")).toHaveTextContent("Q1?");
    click("Save 2 questions");
    await waitFor(() => expect(questionService.createVariant).toHaveBeenCalledTimes(2));
    expect(questionService.createVariant.mock.calls[1][1].questionText).toBe("What is 2+2?");
  });

  it("regenerates a single draft in place", async () => {
    await generateBatch(["Q1?", "Q2?", "Q3?"]);
    eduaiService.generateQuestions.mockResolvedValue({ data: { questions: [mcq("New Q2?")] } });
    fireEvent.click(screen.getByText("regenerate-2"));
    expect(await screen.findByText("New Q2?")).toBeInTheDocument();
    expect(eduaiService.generateQuestions).toHaveBeenLastCalledWith(
      expect.objectContaining({ numQuestions: 1 }),
    );
    expect(screen.getByText("Q1?")).toBeInTheDocument();
    expect(screen.getByText("Q3?")).toBeInTheDocument();
    expect(screen.queryByText("Q2?")).toBeNull();
    expect(toastFn).toHaveBeenCalledWith("Draft regenerated", expect.anything());
  });

  it("opens an invalid kept draft in the editor instead of saving", async () => {
    eduaiService.generateQuestions.mockResolvedValue({
      data: { questions: [mcq("Q1?"), { ...mcq(""), content: "" }] },
    });
    render(<QuestionComposerPage />);
    await goToStep3("ai");
    fireEvent.click(screen.getByText("set-prompt"));
    fireEvent.click(screen.getByText("set-count-3"));
    click("Generate");
    await screen.findByTestId("draft-2");
    click("Save 2 questions");
    expect(await screen.findByText("Editing draft 2")).toBeInTheDocument();
    expect(screen.getByText("Question text is required.")).toBeInTheDocument();
    expect(questionService.createQuestion).not.toHaveBeenCalled();
  });

  it("drops saved drafts and stays on the step when a later save fails", async () => {
    questionService.createQuestion
      .mockResolvedValueOnce({ id: 99 })
      .mockRejectedValueOnce(new Error("boom"));
    questionService.createVariant.mockResolvedValue({ id: 1 });
    await generateBatch(["Q1?", "Q2?", "Q3?"]);
    click("Save 3 questions");
    expect(
      await screen.findByText(/Saved 1 of 3; the rest were not saved\. boom/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Q1?")).toBeNull();
    expect(screen.getByText("Q2?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save 2 questions" })).toBeEnabled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("handles a partial result", async () => {
    await generateBatch(["Q1?", "Q2?"]);
    expect(screen.getByTestId("draft-2")).toBeInTheDocument();
    expect(toastFn).toHaveBeenCalledWith("Generated 2 of 3 questions", expect.anything());
  });

  it("confirms before cancelling or regenerating with unsaved drafts", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await generateBatch(["Q1?", "Q2?", "Q3?"]);
    // The header back arrow and the footer button are both named "Cancel".
    for (const cancel of screen.getAllByRole("button", { name: /^cancel$/i })) {
      fireEvent.click(cancel);
    }
    expect(navigateMock).not.toHaveBeenCalled();
    click("Regenerate");
    expect(eduaiService.generateQuestions).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Q1?")).toBeInTheDocument();
    expect(confirmSpy).toHaveBeenCalledTimes(3);
    confirmSpy.mockRestore();
  });

  it("builds drafts from topics that finish loading while generation runs", async () => {
    let resolveTopics: (topics: Array<{ id: string; name: string }>) => void = () => {};
    courseService.getCourseTopics.mockReturnValue(
      new Promise((resolve) => {
        resolveTopics = resolve;
      }),
    );
    let resolveGeneration: (value: {
      data: { questions: ReturnType<typeof mcq>[] };
    }) => void = () => {};
    eduaiService.generateQuestions.mockReturnValue(
      new Promise((resolve) => {
        resolveGeneration = resolve;
      }),
    );
    questionService.createQuestion.mockResolvedValue({ id: 99 });
    questionService.createVariant.mockResolvedValue({ id: 1 });
    render(<QuestionComposerPage />);
    await goToStep3("ai");
    fireEvent.click(screen.getByText("set-prompt"));
    fireEvent.click(screen.getByText("set-count-3"));
    // The panel waits for topics; generation itself is not gated by the page here.
    click("Generate");
    await waitFor(() => expect(eduaiService.generateQuestions).toHaveBeenCalled());

    resolveTopics([{ id: "t1", name: "Topic 1" }]);
    await waitFor(() => expect(screen.getByTestId("ai-disabled")).toHaveTextContent("false"));
    resolveGeneration({ data: { questions: ["Q1?", "Q2?", "Q3?"].map(mcq) } });
    await screen.findByTestId("draft-3");

    click("Save 3 questions");
    await waitFor(() =>
      expect(questionService.createQuestion).toHaveBeenCalledWith(
        expect.objectContaining({ primaryTopicId: "t1" }),
      ),
    );
  });
});
