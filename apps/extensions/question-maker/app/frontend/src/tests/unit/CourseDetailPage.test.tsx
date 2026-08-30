/**
 * Unit tests for CourseDetailPage (#1544). All child components, hooks, and
 * services are mocked so we exercise the page's own logic — gate states, tab
 * wiring, question/assessment loading, and the various handlers — without
 * depending on the real design-system tree or network calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Question, Assessment } from "@/types/question";

afterEach(cleanup);

// `vi.mock` factories are hoisted above every other top-level statement in this
// file (including imports), so anything a factory references must itself be
// created inside `vi.hoisted` — a plain `const` here throws a TDZ
// ReferenceError the moment the hoisted factory runs.
const {
  navigateMock,
  setSearchParamsMock,
  searchParamsBox,
  toastFn,
  useCourseFromRouteMock,
  useQmPermissionsForCourseMock,
  guidedTour,
  qmLayout,
  questionService,
  courseService,
  assessmentService,
  tabsBox,
} = vi.hoisted(() => {
  const toast = vi.fn(() => "toast-id") as any;
  toast.error = vi.fn();
  toast.dismiss = vi.fn();
  return {
    navigateMock: vi.fn(),
    setSearchParamsMock: vi.fn(),
    searchParamsBox: { current: new URLSearchParams() },
    toastFn: toast,
    useCourseFromRouteMock: vi.fn(),
    useQmPermissionsForCourseMock: vi.fn(),
    guidedTour: {
      startTour: vi.fn(),
      registerOnTourEnd: vi.fn(),
      registerStepAction: vi.fn(() => vi.fn()),
      isActive: false as boolean,
      activeTourId: null as string | null,
    },
    qmLayout: { setGuidedTourHandler: vi.fn() },
    questionService: {
      getQuestionsPage: vi.fn(),
      getQuestionStats: vi.fn(),
      getQuestion: vi.fn(),
      deleteQuestion: vi.fn(),
      deleteVariant: vi.fn(),
      extractQuestionsFromText: vi.fn(),
    },
    courseService: { getCourseTopics: vi.fn() },
    assessmentService: {
      getAssessmentsPage: vi.fn(),
      createAssessment: vi.fn(),
      deleteAssessment: vi.fn(),
    },
    // Plain mutable bag standing in for tab state. `PageTabs` writes into it
    // during its own render, and `PageTabsTrigger`/`PageTabsContent` (rendered
    // as its children in the same pass) read the already-updated value — no
    // React context needed, which matters because `createContext` needs the
    // real `react` module and can't be constructed inside `vi.hoisted`.
    tabsBox: { value: "", onValueChange: (() => {}) as (v: string) => void },
  };
});

// ── react-router ─────────────────────────────────────────────────────────────
vi.mock("react-router", () => ({
  useNavigate: () => navigateMock,
  useSearchParams: () => [searchParamsBox.current, setSearchParamsMock],
}));

// ── sonner ───────────────────────────────────────────────────────────────────
vi.mock("sonner", () => ({ toast: toastFn }));

// ── hooks / contexts ─────────────────────────────────────────────────────────
vi.mock("@/hooks/useCourseFromRoute", () => ({
  useCourseFromRoute: () => useCourseFromRouteMock(),
}));

vi.mock("@/hooks/useQmPermissions", () => ({
  useQmPermissionsForCourse: () => useQmPermissionsForCourseMock(),
}));

vi.mock("@/contexts/GuidedTourContext", () => ({
  useGuidedTour: () => guidedTour,
}));

vi.mock("@/components/layout/QmLayoutContext", () => ({
  useQmLayout: () => qmLayout,
}));

// ── services ─────────────────────────────────────────────────────────────────
vi.mock("@/services/questionService", () => ({ questionService }));

vi.mock("@/services/courseService", () => ({ courseService }));

vi.mock("@/services/assessmentService", () => ({ default: assessmentService }));

vi.mock("@/services/questionBankService", () => ({
  questionBankService: {
    listBanks: vi.fn().mockResolvedValue([]),
    createBank: vi.fn().mockResolvedValue({ id: 1, name: "Bank" }),
    deleteBank: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── @eduai/ui ────────────────────────────────────────────────────────────────
vi.mock("@eduai/ui", () => ({
  PageTabs: ({ value, onValueChange, children }: any) => {
    tabsBox.value = value;
    tabsBox.onValueChange = onValueChange;
    return <>{children}</>;
  },
  PageTabsList: ({ children }: any) => <div>{children}</div>,
  PageTabsTrigger: ({ value, children }: any) => (
    <button onClick={() => tabsBox.onValueChange(value)}>{children}</button>
  ),
  PageTabsContent: ({ value, children }: any) =>
    tabsBox.value === value ? <div>{children}</div> : null,
  CourseHeroCard: (props: any) => (
    <div data-testid="hero">
      <span>{props.name}</span>
      {props.topRightBadges?.map((b: string) => (
        <span key={b}>{b}</span>
      ))}
      {props.topicsAction}
    </div>
  ),
  DetailPageScaffold: ({ beforeHero, hero, children }: any) => (
    <div>
      {beforeHero}
      {hero}
      {children}
    </div>
  ),
  Card: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h2>{children}</h2>,
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Alert: ({ children }: any) => <div role="alert">{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
  Skeleton: () => <div data-testid="skeleton" />,
  cn: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" "),
  resolvePaletteAccent: () => "#000",
  ConfirmDialog: ({ open, onConfirm, title, description, confirmLabel, isLoading }: any) =>
    open ? (
      <div role="alertdialog">
        <h2>{title}</h2>
        <p>{description}</p>
        <button onClick={onConfirm} disabled={isLoading}>
          {confirmLabel}
        </button>
      </div>
    ) : null,
}));

// ── local child components ──────────────────────────────────────────────────
vi.mock("@/components/question-bank/QuestionBank", () => ({
  QuestionBank: (props: any) => (
    <div data-testid="question-bank">
      <span data-testid="qb-loading">{String(props.isLoading)}</span>
      <span data-testid="qb-empty">{props.emptyMessage}</span>
      <button disabled={props.disableAdd} onClick={props.onAddQuestion}>
        add-question
      </button>
      <button disabled={props.disableUpload} onClick={props.onUploadQuestions}>
        upload-questions
      </button>
      <button onClick={props.onOpenProfile}>open-profile</button>
      {props.variants[0] && (
        <>
          <button onClick={() => props.onViewVariant(props.variants[0])}>view-variant</button>
          <button onClick={() => props.onCreateVariant(props.variants[0])}>create-variant</button>
        </>
      )}
    </div>
  ),
}));

vi.mock("@/components/assessments/AssessmentSection", () => ({
  AssessmentSection: (props: any) => (
    <div data-testid="assessment-section">
      <span data-testid="as-loading">{String(props.isLoading)}</span>
      <span data-testid="as-error">{props.loadError}</span>
      <button onClick={() => props.onAddAssessment({ name: "New A" })}>add-assessment</button>
      <button onClick={props.onImportFromCanvas}>import-canvas</button>
      {props.assessments.map((a: Assessment) => (
        <div key={a.id}>
          <span>{a.name}</span>
          <button onClick={() => props.onDeleteAssessment(a.id, a.name)}>delete-{a.id}</button>
          <button onClick={() => props.onExportToTxt(a.id, a.name)}>export-txt-{a.id}</button>
          <button onClick={() => props.onExportToWord(a.id, a.name)}>export-word-{a.id}</button>
          <button onClick={() => props.onExportToCanvas(a.id, a.name)}>export-canvas-{a.id}</button>
        </div>
      ))}
    </div>
  ),
}));

vi.mock("@/components/shared/ListPaginationBar", () => ({
  DEFAULT_LIST_PAGE_SIZE: 25,
  ListPaginationBar: (props: any) => (
    <div data-testid={`pager-${props.itemLabel}`}>
      <button onClick={() => props.onPageChange(props.offset + props.limit)}>
        next-{props.itemLabel}
      </button>
    </div>
  ),
}));

vi.mock("@/components/questions/QuestionModal", () => ({
  QuestionModal: (props: any) =>
    props.open ? (
      <div data-testid="question-modal">
        <button onClick={props.onClose}>close-modal</button>
        <button onClick={() => props.onCreateVariant(props.entry)}>modal-create-variant</button>
        <button onClick={() => props.onDeleteVariant(props.entry)}>modal-delete-variant</button>
        <button
          onClick={() =>
            props.onUpdateQuestionMetadata(props.entry.questionId, { description: "updated" })
          }
        >
          modal-update-metadata
        </button>
      </div>
    ) : null,
}));

vi.mock("@/pages/course-detail/CourseOverviewTab", () => ({
  CourseOverviewTab: (props: any) => (
    <div data-testid="overview-tab">
      <span>{props.questionsCount}</span>
      <button onClick={props.onAddQuestion}>overview-add-question</button>
      <button onClick={props.onNewAssessment}>overview-new-assessment</button>
      <button onClick={props.onImportFromCanvas}>overview-import-canvas</button>
    </div>
  ),
}));

vi.mock("@/pages/course-detail/CourseTopicsHeroAction", () => ({
  CourseTopicsHeroAction: (props: any) => (
    <button onClick={props.onTopicsChange}>topics-action</button>
  ),
}));

vi.mock("@/pages/course-detail/CourseCanvasTab", () => ({
  CourseCanvasTab: () => <div data-testid="canvas-tab" />,
}));

vi.mock("@/components/question-bank/QuestionUploadDialog", () => ({
  QuestionUploadDialog: (props: any) =>
    props.open ? (
      <div data-testid="upload-dialog">
        <button onClick={props.onClose}>close-upload</button>
        <button onClick={() => props.onQuestionsSaved([])}>save-empty</button>
        <button
          onClick={() => props.onQuestionsSaved([{ id: 99, courseId: 5, createdAt: "2024-01-01" }])}
        >
          save-questions
        </button>
        <button
          onClick={() =>
            props.onExtractInBackground({
              text: "x",
              courseId: 5,
              model: "m",
              apiKeys: {},
            })
          }
        >
          extract
        </button>
      </div>
    ) : null,
  mapExtractedToDraftQuestions: (items: any[]) => items,
}));

vi.mock("@/components/canvas/CanvasExportDialog", () => ({
  CanvasExportDialog: (props: any) =>
    props.open ? (
      <div data-testid="canvas-export-dialog">
        <button onClick={props.onClose}>close-export</button>
        <button onClick={() => props.onExportSuccess({ quizId: "q1" })}>export-success</button>
      </div>
    ) : null,
}));

vi.mock("@/components/canvas/CanvasImportDialog", () => ({
  CanvasImportDialog: (props: any) =>
    props.open ? (
      <div data-testid="canvas-import-dialog">
        <button onClick={props.onClose}>close-import</button>
        <button onClick={() => props.onImportSuccess()}>import-success</button>
      </div>
    ) : null,
}));

vi.mock("@/components/canvas/CanvasBankSyncDialog", () => ({
  CanvasBankSyncDialog: () => null,
}));

vi.mock("@/components/rbac/CourseNoAccessAlert", () => ({
  CourseNoAccessAlert: (props: any) => <button onClick={props.onGoToCourses}>no-access</button>,
}));

vi.mock("@/utils/assessmentExport", () => ({
  assessmentBlocksToDocxBlob: vi.fn(async () => new Blob(["x"])),
  assessmentBlocksToPlainText: vi.fn(() => "plain text"),
  collectAssessmentExportBlocks: vi.fn((assessment: Assessment) =>
    assessment.sections?.length ? [{}] : [],
  ),
  slugifyAssessmentBasename: vi.fn(() => "slug"),
}));

import { CourseDetailPage } from "@/pages/CourseDetailPage";

// ── test fixtures ────────────────────────────────────────────────────────────
const course = {
  id: 5,
  name: "Intro to Testing",
  code: "TST101",
  description: "A course",
  term: "Fall",
  year: 2026,
  coreCourseId: null,
};

const question: Question = {
  id: 1,
  description: "Q1",
  type: "MCQ",
  courseId: 5,
  primaryTopicId: "t1",
  questionOrder: null,
  createdAt: "2024-01-01",
  updatedAt: "2024-01-01",
  variants: [
    {
      id: 10,
      questionText: "What is 2+2?",
      difficulty: "easy",
      assessmentId: null,
      secondaryTopicsId: null,
      referenceId: null,
      answer: "4",
      isAiGenerated: false,
      isDraft: true,
    } as any,
  ],
} as any;

const assessment: Assessment = {
  id: 100,
  type: "Quiz",
  name: "Quiz 1",
  semester: "Fall 2026",
  courseId: 5,
  createdAt: "2024-01-01",
  updatedAt: "2024-01-01",
  sections: [{ id: 1, sectionVariants: [{ variant: { isDraft: false } }] } as any],
};

function setDefaultMocks(overrides: Partial<{ tab: string }> = {}) {
  searchParamsBox.current = new URLSearchParams(overrides.tab ? `tab=${overrides.tab}` : "");
  useCourseFromRouteMock.mockReturnValue({
    course,
    courseId: 5,
    isLoading: false,
    notFound: false,
  });
  useQmPermissionsForCourseMock.mockReturnValue({
    canCreateQuestion: true,
    canManageCanvas: true,
    hasCourseAccess: true,
    accessLoading: false,
  });
  questionService.getQuestionsPage.mockResolvedValue({ items: [question], total: 1 });
  questionService.getQuestionStats.mockResolvedValue({
    totalQuestions: 1,
    totalVariants: 1,
    typeStats: [{ type: "MCQ", count: 1 }],
    difficultyStats: [{ difficulty: "easy", count: 1 }],
    aiCount: 0,
    humanCount: 1,
    reviewedCount: 0,
    usedTopicIds: [],
  });
  courseService.getCourseTopics.mockResolvedValue([{ id: "t1", name: "Topic 1" }]);
  assessmentService.getAssessmentsPage.mockResolvedValue({ items: [assessment], total: 1 });
}

beforeEach(() => {
  vi.clearAllMocks();
  guidedTour.isActive = false;
  guidedTour.activeTourId = null;
  setDefaultMocks();
});

describe("CourseDetailPage gate states", () => {
  it("shows a skeleton while course or access is loading", () => {
    useCourseFromRouteMock.mockReturnValue({
      course: null,
      courseId: null,
      isLoading: true,
      notFound: false,
    });
    useQmPermissionsForCourseMock.mockReturnValue({
      canCreateQuestion: false,
      hasCourseAccess: false,
      accessLoading: false,
    });
    render(<CourseDetailPage />);
    expect(screen.getByRole("status", { name: /Loading course detail/i })).toBeInTheDocument();
  });

  it("shows not-found card when the course does not exist", () => {
    useCourseFromRouteMock.mockReturnValue({
      course: null,
      courseId: 5,
      isLoading: false,
      notFound: true,
    });
    render(<CourseDetailPage />);
    expect(screen.getByText("Course not found")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to Courses" }));
    expect(navigateMock).toHaveBeenCalledWith("/courses");
  });
});

describe("CourseDetailPage main content", () => {
  it("renders the hero and overview tab by default, loading data", async () => {
    render(<CourseDetailPage />);
    expect(await screen.findByTestId("overview-tab")).toBeInTheDocument();
    await waitFor(() => expect(questionService.getQuestionsPage).toHaveBeenCalled());
    await waitFor(() => expect(assessmentService.getAssessmentsPage).toHaveBeenCalled());
    await waitFor(() => expect(courseService.getCourseTopics).toHaveBeenCalled());
    expect(screen.getByText("Intro to Testing")).toBeInTheDocument();
  });

  it("shows the no-access alert and read-only badge when access is missing", async () => {
    useQmPermissionsForCourseMock.mockReturnValue({
      canCreateQuestion: false,
      hasCourseAccess: false,
      accessLoading: false,
    });
    render(<CourseDetailPage />);
    expect(screen.getByText("no-access")).toBeInTheDocument();
    expect(await screen.findByText("Read-only")).toBeInTheDocument();
    fireEvent.click(screen.getByText("no-access"));
    expect(navigateMock).toHaveBeenCalledWith("/courses");
  });

  it("handles a questions-loading failure", async () => {
    setDefaultMocks({ tab: "questions" });
    questionService.getQuestionsPage.mockRejectedValue({ response: { data: { error: "boom" } } });
    render(<CourseDetailPage />);
    await waitFor(() => expect(screen.getAllByText("boom").length).toBeGreaterThan(0));
  });

  it("renders the questions tab and wires QuestionBank callbacks", async () => {
    setDefaultMocks({ tab: "questions" });
    render(<CourseDetailPage />);
    await screen.findByTestId("question-bank");
    expect(screen.getByTestId("qb-loading")).toHaveTextContent("false");

    fireEvent.click(screen.getByText("add-question"));
    expect(navigateMock).toHaveBeenCalledWith("/courses/5/questions/new");

    fireEvent.click(screen.getByText("upload-questions"));
    expect(await screen.findByTestId("upload-dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByText("open-profile"));
    expect(guidedTour.startTour).toHaveBeenCalledWith("main");
  });

  it("opens and closes the question detail modal", async () => {
    setDefaultMocks({ tab: "questions" });
    render(<CourseDetailPage />);
    await screen.findByTestId("question-bank");
    fireEvent.click(screen.getByText("view-variant"));
    expect(await screen.findByTestId("question-modal")).toBeInTheDocument();
    fireEvent.click(screen.getByText("close-modal"));
    await waitFor(() => expect(screen.queryByTestId("question-modal")).not.toBeInTheDocument());
  });

  it("navigates to create a variant from the question bank and from the modal", async () => {
    setDefaultMocks({ tab: "questions" });
    render(<CourseDetailPage />);
    await screen.findByTestId("question-bank");
    fireEvent.click(screen.getByText("create-variant"));
    expect(navigateMock).toHaveBeenCalledWith("/courses/5/questions/new?variantOf=1");
  });

  it("deletes the last remaining variant as a full question delete", async () => {
    questionService.deleteQuestion.mockResolvedValue(undefined);
    setDefaultMocks({ tab: "questions" });
    render(<CourseDetailPage />);
    await screen.findByTestId("question-bank");
    fireEvent.click(screen.getByText("view-variant"));
    fireEvent.click(await screen.findByText("modal-delete-variant"));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete question?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(questionService.deleteQuestion).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("reports a variant-delete failure", async () => {
    questionService.deleteQuestion.mockRejectedValue(new Error("nope"));
    setDefaultMocks({ tab: "questions" });
    render(<CourseDetailPage />);
    await screen.findByTestId("question-bank");
    fireEvent.click(screen.getByText("view-variant"));
    fireEvent.click(await screen.findByText("modal-delete-variant"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(toastFn.error).toHaveBeenCalled());
  });

  it("updates question metadata from the modal, refetching the question", async () => {
    questionService.getQuestion.mockResolvedValue({
      ...question,
      description: "updated",
      variants: question.variants,
    });
    setDefaultMocks({ tab: "questions" });
    render(<CourseDetailPage />);
    await screen.findByTestId("question-bank");
    fireEvent.click(screen.getByText("view-variant"));
    fireEvent.click(await screen.findByText("modal-update-metadata"));
    await waitFor(() => expect(questionService.getQuestion).toHaveBeenCalledWith(1));
  });

  it("saves uploaded questions and merges them into the list", async () => {
    setDefaultMocks({ tab: "questions" });
    render(<CourseDetailPage />);
    await screen.findByTestId("question-bank");
    fireEvent.click(screen.getByText("upload-questions"));
    fireEvent.click(await screen.findByText("save-questions"));
    await waitFor(() => expect(screen.queryByTestId("upload-dialog")).not.toBeInTheDocument());
  });

  it("closes the upload dialog when zero questions are saved", async () => {
    setDefaultMocks({ tab: "questions" });
    render(<CourseDetailPage />);
    await screen.findByTestId("question-bank");
    fireEvent.click(screen.getByText("upload-questions"));
    fireEvent.click(await screen.findByText("save-empty"));
    await waitFor(() => expect(screen.queryByTestId("upload-dialog")).not.toBeInTheDocument());
  });

  it("extracts questions in the background and shows a ready toast", async () => {
    questionService.extractQuestionsFromText.mockResolvedValue([{ id: 1 }]);
    setDefaultMocks({ tab: "questions" });
    render(<CourseDetailPage />);
    await screen.findByTestId("question-bank");
    fireEvent.click(screen.getByText("upload-questions"));
    fireEvent.click(await screen.findByText("extract"));
    await waitFor(() => expect(questionService.extractQuestionsFromText).toHaveBeenCalled());
  });

  it("surfaces an extraction failure toast", async () => {
    questionService.extractQuestionsFromText.mockRejectedValue({ message: "extraction blew up" });
    setDefaultMocks({ tab: "questions" });
    render(<CourseDetailPage />);
    await screen.findByTestId("question-bank");
    fireEvent.click(screen.getByText("upload-questions"));
    fireEvent.click(await screen.findByText("extract"));
    await waitFor(() =>
      expect(toastFn.error).toHaveBeenCalledWith("Extraction failed", expect.anything()),
    );
  });

  it("pages through questions via ListPaginationBar", async () => {
    setDefaultMocks({ tab: "questions" });
    render(<CourseDetailPage />);
    await screen.findByTestId("pager-questions");
    fireEvent.click(screen.getByText("next-questions"));
    await waitFor(() => expect(questionService.getQuestionsPage).toHaveBeenCalledTimes(2));
  });
});

describe("CourseDetailPage assessments tab", () => {
  it("renders assessments, creates one, and paginates", async () => {
    setDefaultMocks({ tab: "assessments" });
    render(<CourseDetailPage />);
    await screen.findByTestId("assessment-section");
    expect(screen.getByText("Quiz 1")).toBeInTheDocument();

    assessmentService.createAssessment.mockResolvedValue({ ...assessment, id: 200, name: "New A" });
    fireEvent.click(screen.getByText("add-assessment"));
    await waitFor(() => expect(assessmentService.createAssessment).toHaveBeenCalled());

    fireEvent.click(screen.getByText("next-assessments"));
    await waitFor(() => expect(assessmentService.getAssessmentsPage).toHaveBeenCalledTimes(2));
  });

  it("reports an assessment-creation failure", async () => {
    assessmentService.createAssessment.mockRejectedValue(new Error("fail"));
    setDefaultMocks({ tab: "assessments" });
    render(<CourseDetailPage />);
    await screen.findByTestId("assessment-section");
    fireEvent.click(screen.getByText("add-assessment"));
    await waitFor(() => expect(toastFn.error).toHaveBeenCalled());
  });

  it("handles an assessments-loading failure", async () => {
    setDefaultMocks({ tab: "assessments" });
    assessmentService.getAssessmentsPage.mockRejectedValue({
      response: { data: { error: "assessments broke" } },
    });
    render(<CourseDetailPage />);
    await waitFor(() => expect(screen.getAllByText("assessments broke").length).toBeGreaterThan(0));
  });

  it("deletes an assessment through the confirm dialog", async () => {
    assessmentService.deleteAssessment.mockResolvedValue(undefined);
    setDefaultMocks({ tab: "assessments" });
    render(<CourseDetailPage />);
    await screen.findByTestId("assessment-section");
    fireEvent.click(screen.getByText("delete-100"));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText('Delete assessment "Quiz 1"?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(assessmentService.deleteAssessment).toHaveBeenCalledWith(100));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("reports an assessment-deletion failure", async () => {
    assessmentService.deleteAssessment.mockRejectedValue(new Error("fail"));
    setDefaultMocks({ tab: "assessments" });
    render(<CourseDetailPage />);
    await screen.findByTestId("assessment-section");
    fireEvent.click(screen.getByText("delete-100"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(toastFn.error).toHaveBeenCalledWith("Failed to delete assessment", expect.anything()),
    );
  });

  it("exports an assessment to TXT", async () => {
    const createObjectURL = vi.fn(() => "blob:url");
    const revokeObjectURL = vi.fn();
    (URL as any).createObjectURL = createObjectURL;
    (URL as any).revokeObjectURL = revokeObjectURL;
    setDefaultMocks({ tab: "assessments" });
    render(<CourseDetailPage />);
    await screen.findByTestId("assessment-section");
    fireEvent.click(screen.getByText("export-txt-100"));
    expect(createObjectURL).toHaveBeenCalled();
    expect(toastFn).toHaveBeenCalledWith("Export started", expect.anything());
  });

  it("exports an assessment to Word", async () => {
    (URL as any).createObjectURL = vi.fn(() => "blob:url");
    (URL as any).revokeObjectURL = vi.fn();
    setDefaultMocks({ tab: "assessments" });
    render(<CourseDetailPage />);
    await screen.findByTestId("assessment-section");
    fireEvent.click(screen.getByText("export-word-100"));
    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith(
        "Export started",
        expect.objectContaining({ description: expect.stringContaining("Word") }),
      ),
    );
  });

  it("blocks export when the assessment has no exportable blocks", async () => {
    const emptyAssessment = { ...assessment, id: 300, name: "Empty", sections: [] };
    assessmentService.getAssessmentsPage.mockResolvedValue({ items: [emptyAssessment], total: 1 });
    setDefaultMocks({ tab: "assessments" });
    assessmentService.getAssessmentsPage.mockResolvedValue({ items: [emptyAssessment], total: 1 });
    render(<CourseDetailPage />);
    await screen.findByTestId("assessment-section");
    fireEvent.click(await screen.findByText("export-txt-300"));
    expect(toastFn.error).toHaveBeenCalledWith("Cannot export", expect.anything());
  });

  it("opens the Canvas export dialog", async () => {
    setDefaultMocks({ tab: "assessments" });
    render(<CourseDetailPage />);
    await screen.findByTestId("assessment-section");
    fireEvent.click(screen.getByText("export-canvas-100"));
    expect(await screen.findByTestId("canvas-export-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByText("export-success"));
    expect(toastFn).toHaveBeenCalledWith("Export successful!", expect.anything());
  });

  it("opens the Canvas import dialog from the assessments tab and refreshes on success", async () => {
    setDefaultMocks({ tab: "assessments" });
    render(<CourseDetailPage />);
    await screen.findByTestId("assessment-section");
    fireEvent.click(screen.getByText("import-canvas"));
    fireEvent.click(await screen.findByText("import-success"));
    await waitFor(() => expect(assessmentService.getAssessmentsPage).toHaveBeenCalledTimes(2));
  });
});

describe("CourseDetailPage canvas tab", () => {
  it("renders the canvas tab", async () => {
    setDefaultMocks({ tab: "canvas" });
    render(<CourseDetailPage />);
    expect(await screen.findByTestId("canvas-tab")).toBeInTheDocument();
  });
});

describe("CourseDetailPage overview tab actions", () => {
  it("wires overview add-question, new-assessment, and import-from-canvas", async () => {
    render(<CourseDetailPage />);
    await screen.findByTestId("overview-tab");
    fireEvent.click(screen.getByText("overview-add-question"));
    expect(navigateMock).toHaveBeenCalledWith("/courses/5/questions/new");

    fireEvent.click(screen.getByText("overview-import-canvas"));
    expect(await screen.findByTestId("canvas-import-dialog")).toBeInTheDocument();
  });

  it("changes topics via the hero topics action", async () => {
    render(<CourseDetailPage />);
    await screen.findByTestId("overview-tab");
    fireEvent.click(screen.getByText("topics-action"));
    await waitFor(() => expect(courseService.getCourseTopics).toHaveBeenCalledTimes(2));
  });
});

describe("CourseDetailPage guided tour", () => {
  it("registers the tour handler and switches to assessments tab on the tour step", async () => {
    guidedTour.isActive = true;
    guidedTour.activeTourId = "main";
    render(<CourseDetailPage />);
    await screen.findByTestId("overview-tab");
    expect(guidedTour.registerStepAction).toHaveBeenCalledWith(
      "assessment-tab",
      expect.any(Function),
    );
    expect(qmLayout.setGuidedTourHandler).toHaveBeenCalled();
  });
});
