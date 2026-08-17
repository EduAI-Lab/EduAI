/**
 * The view-mode footer's "Mark as Reviewed" / "Mark as Draft" button writes
 * immediately without a confirmation dialog.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
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

describe('AddQuestionDialog review-status actions', () => {
  beforeEach(() => {
    cleanup();
    updateVariant.mockReset();
    updateVariant.mockResolvedValue({ isDraft: false });
  });

  it('writes immediately on the footer click', async () => {
    renderDialog(true);

    clickReviewToggle('Mark as Reviewed');

    await waitFor(() => expect(updateVariant).toHaveBeenCalledTimes(1));
    expect(updateVariant).toHaveBeenCalledWith(10, { isDraft: false });
  });

  it('fires exactly one updateVariant request', async () => {
    const { onUpdateVariant } = renderDialog(true);

    clickReviewToggle('Mark as Reviewed');

    await waitFor(() => expect(updateVariant).toHaveBeenCalledTimes(1));
    // draft -> reviewed means isDraft: false on the wire
    expect(updateVariant).toHaveBeenCalledWith(10, { isDraft: false });
    await waitFor(() => expect(onUpdateVariant).toHaveBeenCalledWith(10, { isDraft: false }));
  });

  it('moves a reviewed variant back to draft directly', async () => {
    updateVariant.mockResolvedValue({ isDraft: true });
    renderDialog(false);

    clickReviewToggle('Mark as Draft');

    await waitFor(() => expect(updateVariant).toHaveBeenCalledTimes(1));
    expect(updateVariant).toHaveBeenCalledWith(10, { isDraft: true });
  });
});
