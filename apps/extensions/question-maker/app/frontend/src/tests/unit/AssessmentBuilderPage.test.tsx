/**
 * Unit tests for AssessmentBuilderPage (#1544): load states, header actions
 * (export/manage menus gated by permissions), section CRUD callbacks passed
 * to AssessmentBuilder, and the delete-assessment confirm flow. Heavy child
 * dialogs (AssessmentBuilder, QuestionModal, CanvasExportDialog,
 * GenerateAssessmentModal, ConfirmDialog) are mocked to shallow stand-ins so
 * we can drive this page's own handlers directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";

const {
  navigateMock,
  paramsBox,
  assessmentService,
  courseService,
  questionService,
  useQmPermissionsForCourseMock,
  toastFn,
} = vi.hoisted(() => {
  const toast = vi.fn() as any;
  toast.error = vi.fn();
  return {
    navigateMock: vi.fn(),
    paramsBox: { current: { assessmentId: "1", courseId: "5" } },
    assessmentService: {
      getAssessment: vi.fn(),
      updateAssessment: vi.fn(),
      deleteAssessment: vi.fn(),
      createSection: vi.fn(),
      updateSection: vi.fn(),
      deleteSection: vi.fn(),
      reorderSections: vi.fn(),
      addVariantToSection: vi.fn(),
      removeVariantFromSection: vi.fn(),
    },
    courseService: { getCourseTopics: vi.fn() },
    questionService: {
      getQuestions: vi.fn(),
      getQuestion: vi.fn(),
      updateVariant: vi.fn(),
      deleteQuestion: vi.fn(),
      deleteVariant: vi.fn(),
    },
    useQmPermissionsForCourseMock: vi.fn(),
    toastFn: toast,
  };
});

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => paramsBox.current,
  };
});
vi.mock("sonner", () => ({ toast: toastFn }));
vi.mock("@/services/assessmentService", () => ({ default: assessmentService }));
vi.mock("@/services/courseService", () => ({ courseService }));
vi.mock("@/services/questionService", () => ({ questionService }));
vi.mock("@/hooks/useQmPermissions", () => ({
  useQmPermissionsForCourse: (...a: any[]) => useQmPermissionsForCourseMock(...a),
}));

let lastBuilderProps: any;
vi.mock("@/components/assessments/AssessmentBuilder", () => ({
  AssessmentBuilder: (props: any) => {
    lastBuilderProps = props;
    return <div>assessment-builder</div>;
  },
}));
let lastViewModalProps: any;
let lastCreateModalProps: any;
vi.mock("@/components/questions/QuestionModal", () => ({
  QuestionModal: (props: any) => {
    if (props.mode === "view") lastViewModalProps = props;
    else lastCreateModalProps = props;
    return props.open ? <div>question-modal-{props.mode}</div> : null;
  },
}));
let lastCanvasExportProps: any;
vi.mock("@/components/canvas/CanvasExportDialog", () => ({
  CanvasExportDialog: (props: any) => {
    lastCanvasExportProps = props;
    return props.open ? <div>canvas-export-dialog</div> : null;
  },
}));
let lastGenerateModalProps: any;
vi.mock("@/components/assessments/GenerateAssessmentModal", () => ({
  default: (props: any) => {
    lastGenerateModalProps = props;
    return props.open ? <div>generate-assessment-modal</div> : null;
  },
}));
vi.mock("@eduai/ui", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    ConfirmDialog: (props: any) =>
      props.open ? (
        <div>
          <p>{props.title}</p>
          <button onClick={() => props.onConfirm()}>confirm-delete</button>
        </div>
      ) : null,
    // Radix's DropdownMenu needs real pointer events to open in jsdom — render
    // the menu content unconditionally instead so we can drive items directly.
    DropdownMenu: ({ children }: any) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
    DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
    DropdownMenuItem: ({ children, onSelect, disabled }: any) => (
      <button disabled={disabled} onClick={() => onSelect?.()}>
        {children}
      </button>
    ),
    DropdownMenuSeparator: () => <hr />,
  };
});

vi.mock("@/utils/assessmentExport", () => ({
  collectAssessmentExportBlocks: vi.fn(() => [{ stem: "Q1", choiceLines: [], answerLine: null }]),
  assessmentBlocksToPlainText: vi.fn(() => "plain text content"),
  assessmentBlocksToDocxBlob: vi.fn(async () => new Blob(["docx content"])),
  slugifyAssessmentBasename: vi.fn(() => "midterm"),
}));

import AssessmentBuilderPage from "@/pages/AssessmentBuilderPage";

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

afterEach(() => {
  cleanup();
  // A couple of export tests stub these on the global URL — restore them so
  // later test files in this worker don't inherit the stub.
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

function renderPage() {
  return render(
    <MemoryRouter>
      <AssessmentBuilderPage />
    </MemoryRouter>,
  );
}

const baseAssessment = {
  id: 1,
  name: "Midterm",
  type: "Assignment",
  courseId: 5,
  course: { id: 5, name: "Intro CS", code: "COSC101" },
  sections: [],
};

const questionWithVariant = {
  id: 20,
  description: "A question",
  type: "MCQ",
  primaryTopicId: "t1",
  courseId: 5,
  course: { name: "Intro CS", code: "COSC101" },
  variants: [{ id: 200, isDraft: false, isAiGenerated: false, difficulty: "easy" }],
};

const assessmentWithReviewedQuestion = {
  ...baseAssessment,
  sections: [{ id: 10, name: "S1", position: 1, sectionVariants: [{ variantId: 200 }] }],
};

const draftQuestionWithVariant = {
  ...questionWithVariant,
  variants: [{ id: 200, isDraft: true, isAiGenerated: false, difficulty: "easy" }],
};

beforeEach(() => {
  paramsBox.current = { assessmentId: "1", courseId: "5" };
  useQmPermissionsForCourseMock.mockReturnValue({
    canManageAssessment: true,
    canExportAssessment: true,
    canUseVariantWorkflow: true,
    hasCourseAccess: true,
    accessLoading: false,
  });
  courseService.getCourseTopics.mockResolvedValue([]);
  questionService.getQuestions.mockResolvedValue([]);
});

describe("AssessmentBuilderPage", () => {
  it("shows a loading state before the assessment loads", () => {
    assessmentService.getAssessment.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText("Loading assessment builder…")).toBeInTheDocument();
  });

  it("shows an invalid-id error when the assessmentId param is not a number", async () => {
    paramsBox.current = { assessmentId: "abc", courseId: "5" };
    renderPage();
    await waitFor(() => expect(screen.getByText("Invalid assessment ID.")).toBeInTheDocument());
  });

  it("shows a not-found error when loading fails", async () => {
    assessmentService.getAssessment.mockRejectedValue({
      response: { data: { error: "Nope" } },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Nope")).toBeInTheDocument());
  });

  it("renders the assessment header once loaded", async () => {
    assessmentService.getAssessment.mockResolvedValue(baseAssessment);
    renderPage();
    await waitFor(() => expect(screen.getByText("Midterm")).toBeInTheDocument());
    expect(screen.getByText("Intro CS")).toBeInTheDocument();
    expect(lastBuilderProps.assessment).toEqual(baseAssessment);
  });

  it("creates a section via AssessmentBuilder onAddSection", async () => {
    assessmentService.getAssessment.mockResolvedValue(baseAssessment);
    assessmentService.createSection.mockResolvedValue({ id: 10, name: "Section 1", position: 1 });
    renderPage();
    await waitFor(() => expect(lastBuilderProps).toBeTruthy());
    await lastBuilderProps.onAddSection();
    expect(assessmentService.createSection).toHaveBeenCalledWith(1, {
      name: "Section 1",
      position: 1,
    });
  });

  it("shows an error toast when section creation fails", async () => {
    assessmentService.getAssessment.mockResolvedValue(baseAssessment);
    assessmentService.createSection.mockRejectedValue({ response: { data: { error: "boom" } } });
    renderPage();
    await waitFor(() => expect(lastBuilderProps).toBeTruthy());
    await lastBuilderProps.onAddSection();
    expect(toastFn.error).toHaveBeenCalledWith(
      "Failed to create section",
      expect.objectContaining({ description: "boom" }),
    );
  });

  it("deletes a section via AssessmentBuilder onDeleteSection", async () => {
    const withSection = {
      ...baseAssessment,
      sections: [{ id: 10, name: "S1", position: 1, sectionVariants: [] }],
    };
    assessmentService.getAssessment.mockResolvedValue(withSection);
    assessmentService.deleteSection.mockResolvedValue(undefined);
    renderPage();
    await waitFor(() => expect(lastBuilderProps).toBeTruthy());
    await lastBuilderProps.onDeleteSection(10);
    expect(assessmentService.deleteSection).toHaveBeenCalledWith(1, 10);
  });

  it("reorders sections via AssessmentBuilder onReorderSections", async () => {
    assessmentService.getAssessment.mockResolvedValue(baseAssessment);
    assessmentService.reorderSections.mockResolvedValue([{ id: 1, position: 1 }]);
    renderPage();
    await waitFor(() => expect(lastBuilderProps).toBeTruthy());
    await lastBuilderProps.onReorderSections([1]);
    expect(assessmentService.reorderSections).toHaveBeenCalledWith(1, [1]);
  });

  it("adds and removes questions from a section", async () => {
    assessmentService.getAssessment.mockResolvedValue(baseAssessment);
    assessmentService.addVariantToSection.mockResolvedValue(undefined);
    assessmentService.removeVariantFromSection.mockResolvedValue(undefined);
    renderPage();
    await waitFor(() => expect(lastBuilderProps).toBeTruthy());
    await lastBuilderProps.onAddQuestionsToSection(10, [100]);
    expect(assessmentService.addVariantToSection).toHaveBeenCalledWith(1, 10, { variantId: 100 });
    await lastBuilderProps.onRemoveQuestionFromSection(10, 100);
    expect(assessmentService.removeVariantFromSection).toHaveBeenCalledWith(1, 10, 100);
  });

  it("renames a section", async () => {
    assessmentService.getAssessment.mockResolvedValue(baseAssessment);
    assessmentService.updateSection.mockResolvedValue(undefined);
    renderPage();
    await waitFor(() => expect(lastBuilderProps).toBeTruthy());
    await lastBuilderProps.onUpdateSectionName(10, "New name");
    expect(assessmentService.updateSection).toHaveBeenCalledWith(1, 10, { name: "New name" });
  });

  it("opens the delete confirmation and deletes the assessment", async () => {
    assessmentService.getAssessment.mockResolvedValue(baseAssessment);
    assessmentService.deleteAssessment.mockResolvedValue(undefined);
    renderPage();
    await waitFor(() => expect(screen.getByText("Midterm")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Manage"));
    fireEvent.click(screen.getByText("Delete assessment"));
    await waitFor(() => expect(screen.getByText("confirm-delete")).toBeInTheDocument());
    fireEvent.click(screen.getByText("confirm-delete"));
    await waitFor(() => expect(assessmentService.deleteAssessment).toHaveBeenCalledWith(1));
    expect(navigateMock).toHaveBeenCalledWith("/courses/5?tab=assessments");
  });

  it("shows a no-course-access alert when the user lacks access", async () => {
    useQmPermissionsForCourseMock.mockReturnValue({
      canManageAssessment: true,
      canExportAssessment: true,
      canUseVariantWorkflow: true,
      hasCourseAccess: false,
      accessLoading: false,
    });
    assessmentService.getAssessment.mockResolvedValue(baseAssessment);
    renderPage();
    await waitFor(() => expect(screen.getByText("Midterm")).toBeInTheDocument());
    expect(screen.getByText(/do not have access to this course/i)).toBeInTheDocument();
  });

  it("opens edit-details modal from the Manage menu", async () => {
    assessmentService.getAssessment.mockResolvedValue(baseAssessment);
    renderPage();
    await waitFor(() => expect(screen.getByText("Midterm")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Manage"));
    fireEvent.click(screen.getByText("Edit details"));
    await waitFor(() => expect(screen.getByText("generate-assessment-modal")).toBeInTheDocument());
  });

  it("updates the assessment blueprint via the edit modal", async () => {
    assessmentService.getAssessment.mockResolvedValue(baseAssessment);
    assessmentService.updateAssessment.mockResolvedValue({ ...baseAssessment, name: "Renamed" });
    renderPage();
    await waitFor(() => expect(screen.getByText("Midterm")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Manage"));
    fireEvent.click(screen.getByText("Edit details"));
    await waitFor(() => expect(lastGenerateModalProps.open).toBe(true));
    await lastGenerateModalProps.onUpdate({ name: "Renamed" });
    expect(assessmentService.updateAssessment).toHaveBeenCalledWith(1, { name: "Renamed" });
  });

  it("disables the export button with a tooltip when there are no questions", async () => {
    assessmentService.getAssessment.mockResolvedValue(baseAssessment);
    renderPage();
    await waitFor(() => expect(screen.getByText("Midterm")).toBeInTheDocument());
    const exportButtons = screen.getAllByText("Export");
    expect(exportButtons[0].closest("button")).toBeDisabled();
  });

  it("shows the export button disabled with a tooltip when questions are drafts", async () => {
    assessmentService.getAssessment.mockResolvedValue(assessmentWithReviewedQuestion);
    questionService.getQuestions.mockResolvedValue([draftQuestionWithVariant]);
    renderPage();
    await waitFor(() => expect(screen.getByText("Midterm")).toBeInTheDocument());
    // Export is gated entirely (Tooltip + disabled button) when drafts remain —
    // the format menu never renders, so we assert the gate itself.
    const exportButtons = screen.getAllByText("Export");
    expect(exportButtons[0].closest("button")).toBeDisabled();
  });

  it("exports as TXT successfully", async () => {
    assessmentService.getAssessment.mockResolvedValue(assessmentWithReviewedQuestion);
    questionService.getQuestions.mockResolvedValue([questionWithVariant]);
    const createObjectURL = vi.fn(() => "blob:txt");
    const revokeObjectURL = vi.fn();
    (global as any).URL.createObjectURL = createObjectURL;
    (global as any).URL.revokeObjectURL = revokeObjectURL;
    renderPage();
    await waitFor(() => expect(screen.getByText("Download as text (.txt)")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Download as text (.txt)"));
    expect(toastFn).toHaveBeenCalledWith(
      "Export started",
      expect.objectContaining({ description: expect.stringContaining("TXT") }),
    );
  });

  it("exports as Word successfully", async () => {
    assessmentService.getAssessment.mockResolvedValue(assessmentWithReviewedQuestion);
    questionService.getQuestions.mockResolvedValue([questionWithVariant]);
    (global as any).URL.createObjectURL = vi.fn(() => "blob:docx");
    (global as any).URL.revokeObjectURL = vi.fn();
    renderPage();
    await waitFor(() => expect(screen.getByText(/Download as Word/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Download as Word/));
    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith(
        "Export started",
        expect.objectContaining({ description: expect.stringContaining("Word") }),
      ),
    );
  });

  it("shows an error toast when Word export fails", async () => {
    const { assessmentBlocksToDocxBlob } = await import("@/utils/assessmentExport");
    (assessmentBlocksToDocxBlob as any).mockRejectedValueOnce(new Error("docx build failed"));
    assessmentService.getAssessment.mockResolvedValue(assessmentWithReviewedQuestion);
    questionService.getQuestions.mockResolvedValue([questionWithVariant]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/Download as Word/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Download as Word/));
    await waitFor(() =>
      expect(toastFn.error).toHaveBeenCalledWith("Export failed", expect.any(Object)),
    );
  });

  it("opens the Canvas export dialog and shows a success toast", async () => {
    assessmentService.getAssessment.mockResolvedValue(assessmentWithReviewedQuestion);
    questionService.getQuestions.mockResolvedValue([questionWithVariant]);
    renderPage();
    await waitFor(() => expect(screen.getByText("Send to Canvas")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Send to Canvas"));
    await waitFor(() => expect(lastCanvasExportProps.open).toBe(true));
    lastCanvasExportProps.onExportSuccess();
    expect(toastFn).toHaveBeenCalledWith(
      "Export successful",
      expect.objectContaining({ description: expect.stringContaining("Canvas") }),
    );
  });

  it("toggles a variant draft status via the view modal", async () => {
    assessmentService.getAssessment.mockResolvedValue(assessmentWithReviewedQuestion);
    questionService.getQuestions.mockResolvedValue([questionWithVariant]);
    questionService.updateVariant.mockResolvedValue(undefined);
    renderPage();
    await waitFor(() => expect(lastViewModalProps).toBeTruthy());
    await lastViewModalProps.onUpdateVariant(200, { isDraft: true });
    expect(questionService.getQuestions).toHaveBeenCalled();
  });

  it("creates a variant from an entry via onCreateVariant", async () => {
    assessmentService.getAssessment.mockResolvedValue(assessmentWithReviewedQuestion);
    questionService.getQuestions.mockResolvedValue([questionWithVariant]);
    renderPage();
    await waitFor(() => expect(lastViewModalProps).toBeTruthy());
    act(() => {
      lastViewModalProps.onCreateVariant({ questionId: 20, variant: { id: 200 } });
    });
    expect(screen.getByText("question-modal-variant")).toBeInTheDocument();
  });

  it("updates question metadata via onUpdateQuestionMetadata", async () => {
    assessmentService.getAssessment.mockResolvedValue(assessmentWithReviewedQuestion);
    questionService.getQuestions.mockResolvedValue([questionWithVariant]);
    questionService.getQuestion.mockResolvedValue(questionWithVariant);
    renderPage();
    await waitFor(() => expect(lastViewModalProps).toBeTruthy());
    await lastViewModalProps.onUpdateQuestionMetadata(20, { description: "New desc" });
    expect(questionService.getQuestion).toHaveBeenCalledWith(20);
  });

  it("shows an error toast when updating question metadata fails", async () => {
    assessmentService.getAssessment.mockResolvedValue(assessmentWithReviewedQuestion);
    questionService.getQuestions.mockResolvedValue([questionWithVariant]);
    questionService.getQuestion.mockRejectedValue({ response: { data: { error: "bad" } } });
    renderPage();
    await waitFor(() => expect(lastViewModalProps).toBeTruthy());
    await lastViewModalProps.onUpdateQuestionMetadata(20, {});
    expect(toastFn.error).toHaveBeenCalledWith("Update failed", expect.any(Object));
  });

  it("deletes a variant (keeping the question) via onDeleteVariant", async () => {
    const twoVariantQuestion = {
      ...questionWithVariant,
      variants: [
        { id: 200, isDraft: false, isAiGenerated: false, difficulty: "easy" },
        { id: 201, isDraft: false, isAiGenerated: false, difficulty: "hard" },
      ],
    };
    assessmentService.getAssessment.mockResolvedValue(assessmentWithReviewedQuestion);
    questionService.getQuestions.mockResolvedValue([twoVariantQuestion]);
    questionService.deleteVariant.mockResolvedValue(undefined);
    renderPage();
    await waitFor(() => expect(lastViewModalProps).toBeTruthy());
    await lastViewModalProps.onDeleteVariant({ questionId: 20, variant: { id: 200 } });
    expect(questionService.deleteVariant).toHaveBeenCalledWith(200);
  });

  it("deletes the question when removing its last variant", async () => {
    assessmentService.getAssessment.mockResolvedValue(assessmentWithReviewedQuestion);
    questionService.getQuestions.mockResolvedValue([questionWithVariant]);
    questionService.deleteQuestion.mockResolvedValue(undefined);
    renderPage();
    await waitFor(() => expect(lastViewModalProps).toBeTruthy());
    await lastViewModalProps.onDeleteVariant({ questionId: 20, variant: { id: 200 } });
    expect(questionService.deleteQuestion).toHaveBeenCalledWith(20);
  });

  it("refreshes and toasts when a question is created", async () => {
    assessmentService.getAssessment.mockResolvedValue(baseAssessment);
    questionService.getQuestions.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(lastCreateModalProps).toBeTruthy());
    lastCreateModalProps.onQuestionCreated({ id: 99 });
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith("Question saved", expect.any(Object)));
  });
});
