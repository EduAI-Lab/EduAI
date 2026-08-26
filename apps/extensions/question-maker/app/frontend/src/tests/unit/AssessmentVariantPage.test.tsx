/**
 * Unit tests for AssessmentVariantPage (#1544) — the 4-step baseline/generate/
 * assemble/AI-review wizard. Hooks, services, and the design system are
 * mocked so we exercise the page's own state machine and handlers.
 *
 * `vi.mock` factories are hoisted above every other top-level statement
 * (including imports), so anything referenced inside one is created via
 * `vi.hoisted` to avoid a TDZ ReferenceError.
 */
import { Children, cloneElement, isValidElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

afterEach(cleanup);

const {
  navigateMock,
  toastFn,
  routeParams,
  searchParamsBox,
  useCoursesMock,
  useQmPermissionsForCourseMock,
  courseService,
  assessmentService,
  assessmentVariantService,
  eduaiService,
  buildAiReviewDocxBlob,
} = vi.hoisted(() => {
  const toast = vi.fn(() => 'toast-id') as any;
  toast.error = vi.fn();
  return {
    navigateMock: vi.fn(),
    toastFn: toast,
    routeParams: { current: {} as { courseId?: string; assessmentId?: string } },
    searchParamsBox: { current: new URLSearchParams() },
    useCoursesMock: vi.fn(),
    useQmPermissionsForCourseMock: vi.fn(),
    courseService: { getCourseTopics: vi.fn() },
    assessmentService: {
      getAssessments: vi.fn(),
      getAssessment: vi.fn(),
      getAssessmentSections: vi.fn(),
    },
    assessmentVariantService: {
      setStudyRole: vi.fn(),
      getBaselineVariantReadiness: vi.fn(),
      generateBankVariants: vi.fn(),
      assembleEquivalentExams: vi.fn(),
      reviewVariantWithAi: vi.fn(),
    },
    eduaiService: { listModels: vi.fn() },
    buildAiReviewDocxBlob: vi.fn(async () => new Blob(['x'])),
  };
});

vi.mock('react-router', () => ({
  useNavigate: () => navigateMock,
  useSearchParams: () => [searchParamsBox.current],
  useParams: () => routeParams.current,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'User 1', role: 'instructor' },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

vi.mock('sonner', () => ({ toast: toastFn }));

vi.mock('@/hooks/useCourses', () => ({ useCourses: () => useCoursesMock() }));
vi.mock('@/hooks/useQmPermissions', () => ({
  useQmPermissionsForCourse: () => useQmPermissionsForCourseMock(),
}));

vi.mock('@/services/courseService', () => ({ courseService }));
vi.mock('@/services/assessmentService', () => ({ default: assessmentService, assessmentService }));
vi.mock('@/services/assessmentVariantService', () => ({ default: assessmentVariantService, assessmentVariantService }));
vi.mock('@/services/eduaiService', () => ({ default: eduaiService, eduaiService }));
vi.mock('@/utils/aiReviewExportDocx', () => ({ buildAiReviewDocxBlob }));

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/components/question-bank/QuestionUploadDialog', () => ({
  QuestionUploadDialog: (props: any) =>
    props.open ? (
      <div data-testid="exam-upload-dialog">
        <button onClick={props.onClose}>close-upload</button>
        <button onClick={() => props.onQuestionsSaved([], { assessmentId: 55 })}>save-exam</button>
      </div>
    ) : null,
}));

vi.mock('@/components/canvas/CanvasImportDialog', () => ({
  CanvasImportDialog: (props: any) =>
    props.open ? (
      <div data-testid="canvas-import-dialog">
        <button onClick={props.onClose}>close-canvas</button>
        <button onClick={() => props.onImportSuccess({ assessmentId: 66, assessmentName: 'Imported exam' })}>
          import-success
        </button>
      </div>
    ) : null,
}));

vi.mock('@/components/assessments/GeneratedVariantsReviewDialog', () => ({
  GeneratedVariantsReviewDialog: (props: any) =>
    props.open ? (
      <div data-testid="review-dialog">
        <button onClick={() => props.onOpenChange(false)}>close-review</button>
        <button onClick={props.onReviewed}>mark-reviewed</button>
      </div>
    ) : null,
}));

// ── @eduai/ui — minimal stand-ins, using prop cloning (not context) so
// multiple simultaneous Select instances each wire to their own handler.
vi.mock('@eduai/ui', () => {
  const injectHandler = (children: any, onValueChange: any): any =>
    Children.map(children, (child) => {
      if (!isValidElement(child)) return child;
      const injected = cloneElement(child as any, { __onValueChange: onValueChange } as any);
      return injected;
    });

  const Select = ({ value, onValueChange, disabled, children }: any) => (
    <div data-select-value={value} data-disabled={disabled}>
      {injectHandler(children, onValueChange)}
    </div>
  );
  const SelectTrigger = ({ children }: any) => <>{children}</>;
  const SelectValue = ({ placeholder }: any) => <span>{placeholder}</span>;
  const SelectContent = ({ children, __onValueChange }: any) => (
    <div>{injectHandler(children, __onValueChange)}</div>
  );
  const SelectItem = ({ value, children, __onValueChange, disabled }: any) => (
    <button type="button" disabled={disabled} onClick={() => __onValueChange?.(value)}>
      {children}
    </button>
  );

  return {
    Spinner: () => <span data-testid="spinner" />,
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
    Button: ({ children, onClick, disabled, ...rest }: any) => (
      <button onClick={onClick} disabled={disabled} {...rest}>{children}</button>
    ),
    Textarea: ({ value, onChange, ...rest }: any) => <textarea value={value} onChange={onChange} {...rest} />,
    Card: ({ children }: any) => <div>{children}</div>,
    CardContent: ({ children }: any) => <div>{children}</div>,
    CardDescription: ({ children }: any) => <p>{children}</p>,
    CardHeader: ({ children }: any) => <div>{children}</div>,
    CardTitle: ({ children }: any) => <h2>{children}</h2>,
    Dialog: ({ open, children }: any) => (open ? <div role="dialog">{children}</div> : null),
    DialogContent: ({ children }: any) => <div>{children}</div>,
    DialogDescription: ({ children }: any) => <p>{children}</p>,
    DialogFooter: ({ children }: any) => <div>{children}</div>,
    DialogHeader: ({ children }: any) => <div>{children}</div>,
    DialogTitle: ({ children }: any) => <h2>{children}</h2>,
    ScrollArea: ({ children }: any) => <div>{children}</div>,
    Badge: ({ children }: any) => <span>{children}</span>,
    Sheet: ({ open, children }: any) => (open ? <div data-testid="sheet">{children}</div> : null),
    SheetContent: ({ children }: any) => <div>{children}</div>,
    SheetHeader: ({ children }: any) => <div>{children}</div>,
    SheetTitle: ({ children }: any) => <h2>{children}</h2>,
    SheetDescription: ({ children }: any) => <p>{children}</p>,
    Separator: () => <hr />,
    cn: (...args: any[]) => args.filter(Boolean).join(' '),
    PermissionGate: ({ allow, children }: any) => (allow ? <>{children}</> : null),
  };
});

import { AssessmentVariantPage } from '@/pages/AssessmentVariantPage';

const course = { id: 5, code: 'TST101', name: 'Testing' };

function baselineAssessment(overrides: Partial<any> = {}) {
  return {
    id: 10,
    name: 'Midterm',
    type: 'Mid',
    courseId: 5,
    blueprintConfig: null,
    sections: [
      {
        position: 0,
        sectionVariants: [
          { displayOrder: 0, variant: { questionMetadataId: 1 } },
        ],
      },
    ],
    ...overrides,
  };
}

function setDefaultMocks() {
  routeParams.current = { courseId: '5', assessmentId: undefined };
  searchParamsBox.current = new URLSearchParams();
  useCoursesMock.mockReturnValue({ courses: [course], loading: false, fetchCourses: vi.fn() });
  useQmPermissionsForCourseMock.mockReturnValue({
    canManageAssessment: true,
    canRunAiReview: true,
    canManageCanvas: true,
  });
  courseService.getCourseTopics.mockResolvedValue([{ id: 't1', name: 'Topic 1' }]);
  assessmentService.getAssessments.mockResolvedValue([baselineAssessment()]);
  assessmentService.getAssessment.mockResolvedValue(baselineAssessment());
  assessmentService.getAssessmentSections.mockResolvedValue(baselineAssessment().sections);
  assessmentVariantService.getBaselineVariantReadiness.mockResolvedValue({
    allReady: false,
    minRequiredNonDraft: 2,
    slots: [
      { questionMetadataId: 1, order: 1, description: 'Q1', questionType: 'MCQ', nonDraftVariantCount: 1, ready: false },
    ],
  });
  eduaiService.listModels.mockResolvedValue([{ id: 'gpt', label: 'GPT' }]);
}

async function selectBaseline() {
  const option = await screen.findByText('Midterm (Mid)');
  fireEvent.click(option);
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  setDefaultMocks();
});

describe('AssessmentVariantPage — course + baseline step', () => {
  it('renders the header and baseline step by default', async () => {
    render(<AssessmentVariantPage />);
    expect(await screen.findByText('Assessment variants')).toBeInTheDocument();
    expect(screen.getByText('TST101')).toBeInTheDocument();
    await waitFor(() => expect(assessmentService.getAssessments).toHaveBeenCalledWith({ courseId: 5 }));
    expect(screen.getByText('Baseline reference exam')).toBeInTheDocument();
  });

  it('navigates back to the assessments tab', async () => {
    render(<AssessmentVariantPage />);
    await screen.findByText('Assessment variants');
    fireEvent.click(screen.getByRole('button', { name: /assessments/i }));
    expect(navigateMock).toHaveBeenCalledWith('/courses/5?tab=assessments');
  });

  it('preselects the baseline from the route param', async () => {
    routeParams.current = { courseId: '5', assessmentId: '10' };
    render(<AssessmentVariantPage />);
    await waitFor(() => expect(assessmentVariantService.getBaselineVariantReadiness).toHaveBeenCalledWith(10, 5));
  });

  it('marks the baseline as the reference exam', async () => {
    assessmentVariantService.setStudyRole.mockResolvedValue(undefined);
    render(<AssessmentVariantPage />);
    await screen.findByText('Baseline reference exam');
    await selectBaseline();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as reference' }));
    await waitFor(() => expect(assessmentVariantService.setStudyRole).toHaveBeenCalledWith(10, 'reference_baseline'));
  });

  it('reports a failure marking the baseline', async () => {
    assessmentVariantService.setStudyRole.mockRejectedValue({ response: { data: { error: 'nope' } } });
    render(<AssessmentVariantPage />);
    await screen.findByText('Baseline reference exam');
    await selectBaseline();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as reference' }));
    await waitFor(() => expect(toastFn.error).toHaveBeenCalledWith('Failed', expect.anything()));
  });

  it('shows the reference-set state once marked', async () => {
    assessmentService.getAssessments.mockResolvedValue([
      baselineAssessment({ blueprintConfig: { studyRole: 'reference_baseline' } }),
    ]);
    render(<AssessmentVariantPage />);
    await screen.findByText('Baseline reference exam');
    await selectBaseline();
    expect(await screen.findByText('Reference set')).toBeInTheDocument();
  });

  it('opens the OCR upload dialog and saves an exam as the new baseline', async () => {
    render(<AssessmentVariantPage />);
    await screen.findByText('Baseline reference exam');
    fireEvent.click(screen.getByRole('button', { name: /ocr upload/i }));
    fireEvent.click(await screen.findByText('save-exam'));
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Baseline exam saved', expect.anything()));
  });

  it('opens the Canvas import dialog and adopts the imported exam as baseline', async () => {
    render(<AssessmentVariantPage />);
    await screen.findByText('Baseline reference exam');
    fireEvent.click(screen.getByRole('button', { name: /import from canvas/i }));
    fireEvent.click(await screen.findByText('import-success'));
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Imported from Canvas', expect.anything()));
  });
});

describe('AssessmentVariantPage — step navigation', () => {
  it('moves forward and back through the stepper via footer controls', async () => {
    render(<AssessmentVariantPage />);
    await screen.findByText('Baseline reference exam');
    expect(screen.getByText('Step 1 of 4 · Baseline')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    expect(screen.getByText('Step 2 of 4 · Generate')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByText('Step 1 of 4 · Baseline')).toBeInTheDocument();
  });

  it('jumps directly to a step via the stepper nav', async () => {
    render(<AssessmentVariantPage />);
    await screen.findByText('Baseline reference exam');
    fireEvent.click(screen.getByText('Assemble'));
    expect(screen.getByRole('heading', { name: 'Assemble variant exam' })).toBeInTheDocument();
  });

  it('shows Done on the last step and returns to assessments', async () => {
    render(<AssessmentVariantPage />);
    await screen.findByText('Baseline reference exam');
    fireEvent.click(screen.getByText('AI review'));
    fireEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(navigateMock).toHaveBeenCalledWith('/courses/5?tab=assessments');
  });
});

describe('AssessmentVariantPage — generate step', () => {
  async function goToGenerateStep() {
    render(<AssessmentVariantPage />);
    await screen.findByText('Baseline reference exam');
    await selectBaseline();
    fireEvent.click(screen.getByText('Generate'));
    await screen.findByText('Generate variants');
  }

  it('shows readiness rows once loaded', async () => {
    await goToGenerateStep();
    await waitFor(() => expect(screen.getByText(/still need an/)).toBeInTheDocument());
    expect(screen.getByText('Q1')).toBeInTheDocument();
  });

  it('generates variants for all questions', async () => {
    assessmentVariantService.generateBankVariants.mockResolvedValue({
      results: [{ createdVariantIds: [1], createdVariants: [{}] }],
      errors: [],
    });
    await goToGenerateStep();
    fireEvent.click(screen.getByRole('button', { name: /generate for all questions/i }));
    await waitFor(() => expect(assessmentVariantService.generateBankVariants).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('review-dialog')).toBeInTheDocument());
  });

  it('reports when no questions exist on the baseline', async () => {
    assessmentService.getAssessment.mockResolvedValue(baselineAssessment({ sections: [] }));
    assessmentService.getAssessmentSections.mockResolvedValue([]);
    await goToGenerateStep();
    fireEvent.click(screen.getByRole('button', { name: /generate for all questions/i }));
    await waitFor(() =>
      expect(toastFn.error).toHaveBeenCalledWith('No questions found', expect.anything()),
    );
  });

  it('reports when generation returns zero created variants', async () => {
    assessmentVariantService.generateBankVariants.mockResolvedValue({ results: [], errors: ['bad'] });
    await goToGenerateStep();
    fireEvent.click(screen.getByRole('button', { name: /generate for all questions/i }));
    await waitFor(() =>
      expect(toastFn.error).toHaveBeenCalledWith('No variants were generated', expect.anything()),
    );
  });

  it('reports a generation service failure', async () => {
    assessmentVariantService.generateBankVariants.mockRejectedValue({ response: { data: { error: 'boom' } } });
    await goToGenerateStep();
    fireEvent.click(screen.getByRole('button', { name: /generate for all questions/i }));
    await waitFor(() =>
      expect(toastFn.error).toHaveBeenCalledWith('Variant generation failed', expect.anything()),
    );
  });

  it('offers a missing-only pass when readiness is mixed', async () => {
    assessmentVariantService.getBaselineVariantReadiness.mockResolvedValue({
      allReady: false,
      minRequiredNonDraft: 2,
      slots: [
        { questionMetadataId: 1, order: 1, description: 'Q1', questionType: 'MCQ', nonDraftVariantCount: 1, ready: false },
        { questionMetadataId: 2, order: 2, description: 'Q2', questionType: 'MCQ', nonDraftVariantCount: 2, ready: true },
      ],
    });
    assessmentVariantService.generateBankVariants.mockResolvedValue({
      results: [{ createdVariantIds: [2], createdVariants: [{}] }],
      errors: [],
    });
    await goToGenerateStep();
    const missingButton = await screen.findByRole('button', { name: /missing only/i });
    fireEvent.click(missingButton);
    await waitFor(() =>
      expect(assessmentVariantService.generateBankVariants).toHaveBeenCalledWith(
        expect.objectContaining({ questionIds: [1] }),
      ),
    );
  });
});

describe('AssessmentVariantPage — assemble step', () => {
  it('assembles a variant exam and lists it', async () => {
    assessmentVariantService.assembleEquivalentExams.mockResolvedValue({
      createdAssessments: [{ id: 20, name: 'Variant exam' }],
      examCount: 1,
      assemblyTimeMs: 42,
      warnings: [],
    });
    render(<AssessmentVariantPage />);
    await screen.findByText('Baseline reference exam');
    await selectBaseline();
    fireEvent.click(screen.getByText('Assemble'));
    fireEvent.click(screen.getByRole('button', { name: /assemble variant exam/i }));
    await waitFor(() => expect(assessmentVariantService.assembleEquivalentExams).toHaveBeenCalled());
    expect(await screen.findByText('Variant exam')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Variant exam'));
    expect(navigateMock).toHaveBeenCalledWith('/courses/5/assessments/20');
  });

  it('reports an assembly failure', async () => {
    assessmentVariantService.assembleEquivalentExams.mockRejectedValue({ response: { data: { error: 'fail' } } });
    render(<AssessmentVariantPage />);
    await screen.findByText('Baseline reference exam');
    await selectBaseline();
    fireEvent.click(screen.getByText('Assemble'));
    fireEvent.click(screen.getByRole('button', { name: /assemble variant exam/i }));
    await waitFor(() => expect(toastFn.error).toHaveBeenCalledWith('Assembly failed', expect.anything()));
  });
});

describe('AssessmentVariantPage — AI review step', () => {
  async function goToReviewStep() {
    render(<AssessmentVariantPage />);
    await screen.findByText('Baseline reference exam');
    await selectBaseline();
    fireEvent.click(screen.getByText('AI review'));
    await screen.findByText('AI review', { selector: 'h2' });
  }

  it('requires a variant exam different from baseline', async () => {
    await goToReviewStep();
    fireEvent.click(screen.getByRole('button', { name: /run ai review/i }));
    // aiReviewDisabled should be true (no variant id selected) so nothing runs.
    expect(assessmentVariantService.reviewVariantWithAi).not.toHaveBeenCalled();
  });

  it('runs an AI review and renders the results', async () => {
    assessmentService.getAssessments.mockResolvedValue([
      baselineAssessment(),
      { id: 20, name: 'Variant exam', type: 'Mid', courseId: 5 },
    ]);
    assessmentVariantService.reviewVariantWithAi.mockResolvedValue({
      baselineAssessmentId: 10,
      variantAssessmentId: 20,
      comparedSlots: 3,
      baselineSlotCount: 3,
      variantSlotCount: 3,
      reviewTimeMs: 1500,
      examVariantScoreFinal0to100: 88,
      examVariantScoreBase0to100: 80,
      usableQuestionPercentage: 90,
      distinctnessAverage1to5: 4,
      distinctnessFactorAvg: 0.9,
      totalScoreCalculationSummary: 'summary',
      averages: {
        conceptual_equivalence: 4,
        difficulty_similarity: 4,
        structural_validity: 4,
        answer_correctness: 4,
        topic_alignment: 4,
      },
      overallSummary: { summaryText: 'Great', strengths: ['a'], weaknesses: ['b'] },
      usabilityCounts: { usable_as_is: 2, usable_with_edits: 1, unusable: 0 },
      perQuestion: [
        {
          slot: 1,
          variantVariantId: 99,
          conceptual_equivalence: 4,
          difficulty_similarity: 4,
          structural_validity: 4,
          answer_correctness: 4,
          topic_alignment: 4,
          distinctness: 4,
          usability: 'usable_as_is',
          brief_reason: 'Good',
        },
      ],
    });
    await goToReviewStep();
    const variantOptions = await screen.findAllByText('Variant exam');
    fireEvent.click(variantOptions[1] ?? variantOptions[0]);
    fireEvent.click(screen.getByRole('button', { name: /run ai review/i }));
    await waitFor(() => expect(assessmentVariantService.reviewVariantWithAi).toHaveBeenCalled());
    expect(await screen.findByText(/Overall variant score/)).toBeInTheDocument();
    expect(toastFn).toHaveBeenCalledWith('AI review complete', expect.anything());
  });

  it('reports an AI review failure', async () => {
    assessmentService.getAssessments.mockResolvedValue([
      baselineAssessment(),
      { id: 20, name: 'Variant exam', type: 'Mid', courseId: 5 },
    ]);
    assessmentVariantService.reviewVariantWithAi.mockRejectedValue({ response: { data: { error: 'bad rubric' } } });
    await goToReviewStep();
    const variantOptions = await screen.findAllByText('Variant exam');
    fireEvent.click(variantOptions[1] ?? variantOptions[0]);
    fireEvent.click(screen.getByRole('button', { name: /run ai review/i }));
    await waitFor(() => expect(toastFn.error).toHaveBeenCalledWith('AI review failed', expect.anything()));
  });

  it('opens the rubric editor and resets to default', async () => {
    await goToReviewStep();
    fireEvent.click(screen.getByRole('button', { name: /edit rubric/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'custom rubric' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /reset default rubric/i }));
    fireEvent.click(within(dialog).getByRole('button', { name: /^done$/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens history, is empty by default, and closes', async () => {
    await goToReviewStep();
    fireEvent.click(screen.getByRole('button', { name: /history/i }));
    expect(await screen.findByText('No previous AI reviews for this course yet.')).toBeInTheDocument();
  });
});
