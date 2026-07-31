/**
 * #1120 — the second surface that toggles review status. The view-mode footer's
 * "Mark as Reviewed" / "Mark as Draft" button must confirm before it writes:
 * cancelling issues no `updateVariant` request, confirming issues exactly one,
 * and the copy comes from the same shared helper as the assessment-card kebab
 * (see `AssessmentSectionCardReviewConfirm.test.tsx`) so the two cannot drift.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import type { QuestionVariantEntry } from '@/types/question';

const updateVariant = vi.fn();

vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));

vi.mock('@/services/questionService', () => ({
  questionService: {
    updateVariant: (...args: unknown[]) => updateVariant(...args),
    updateQuestion: vi.fn(),
  },
}));

// View mode resolves the Core course id and the topic list on mount; neither is
// under test here, so both resolve empty.
vi.mock('@/services/courseService', () => ({
  courseService: {
    getCourse: vi.fn().mockResolvedValue({ coreCourseId: null }),
    getCourseTopics: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/services/assessmentService', () => ({
  default: { getAssessments: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/services/eduaiService', () => ({
  default: {
    getModels: vi.fn().mockResolvedValue([]),
    getCourses: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/services/apiKeyStorage', () => ({
  apiKeyStorage: {
    getProviderFromModel: vi.fn().mockReturnValue(null),
    getAllApiKeys: vi.fn().mockResolvedValue({}),
    getApiKey: vi.fn().mockResolvedValue(null),
    setApiKey: vi.fn(),
    removeApiKey: vi.fn(),
  },
  isCloudProvider: vi.fn().mockReturnValue(false),
}));

vi.mock('@/hooks/useEduAIStatus', () => ({
  useEduAIStatus: () => ({ status: 'ok', refresh: vi.fn(), setQuestionGenerationPhase: vi.fn() }),
}));

// The toggle lives behind `PermissionGate allow={canApproveVariant}`.
vi.mock('@/hooks/useQmPermissions', () => ({
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

const { AddQuestionDialog } = await import('@/components/questions/AddQuestionDialog');

function makeEntry(isDraft: boolean): QuestionVariantEntry {
  return {
    questionId: 1,
    questionDescription: 'Arithmetic',
    questionType: 'SA',
    primaryTopicId: '1',
    primaryTopicName: 'Addition',
    courseId: 7,
    isDraft,
    isAiGenerated: false,
    variant: {
      id: 10,
      questionText: 'What is 2 + 2?',
      difficulty: 'easy',
      isDraft,
      createdAt: '2026-05-01T10:00:00.000Z',
    },
  } as unknown as QuestionVariantEntry;
}

function renderDialog(isDraft: boolean) {
  const onSelectVariant = vi.fn();
  const onUpdateVariant = vi.fn();

  render(
    <AddQuestionDialog
      mode="view"
      entry={makeEntry(isDraft)}
      relatedVariants={[]}
      onClose={vi.fn()}
      onCreateVariant={vi.fn()}
      onDeleteVariant={vi.fn()}
      onSelectVariant={onSelectVariant}
      onUpdateVariant={onUpdateVariant}
    />,
  );

  return { onSelectVariant, onUpdateVariant };
}

/** The footer toggle, not a kebab item — the issue text describes it as one. */
function clickReviewToggle(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

describe('AddQuestionDialog review-status confirmation', () => {
  beforeEach(() => {
    cleanup();
    updateVariant.mockReset();
    updateVariant.mockResolvedValue({ isDraft: false });
  });

  it('does not write on the footer click alone', async () => {
    renderDialog(true);

    clickReviewToggle('Mark as Reviewed');

    expect(updateVariant).not.toHaveBeenCalled();
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });

  it('fires exactly one updateVariant request when confirmed', async () => {
    const { onUpdateVariant } = renderDialog(true);

    clickReviewToggle('Mark as Reviewed');
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark as reviewed' }));

    await waitFor(() => expect(updateVariant).toHaveBeenCalledTimes(1));
    // draft -> reviewed means isDraft: false on the wire
    expect(updateVariant).toHaveBeenCalledWith(10, { isDraft: false });
    await waitFor(() => expect(onUpdateVariant).toHaveBeenCalledWith(10, { isDraft: false }));
  });

  it('fires no request when cancelled', async () => {
    const { onUpdateVariant } = renderDialog(true);

    clickReviewToggle('Mark as Reviewed');
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(updateVariant).not.toHaveBeenCalled();
    expect(onUpdateVariant).not.toHaveBeenCalled();
  });

  it('uses the demotion copy and payload when moving a reviewed variant back to draft', async () => {
    updateVariant.mockResolvedValue({ isDraft: true });
    renderDialog(false);

    clickReviewToggle('Mark as Draft');
    const dialog = await screen.findByRole('alertdialog');
    // Direction-specific copy from the shared `reviewStatusConfirm` helper.
    expect(within(dialog).getByText(/excluded from export/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Move to draft' }));

    await waitFor(() => expect(updateVariant).toHaveBeenCalledTimes(1));
    expect(updateVariant).toHaveBeenCalledWith(10, { isDraft: true });
  });
});
