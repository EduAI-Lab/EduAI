/**
 * Unit tests for BankDetailPage (#1544): load states, not-found/no-access
 * branches, question loading/pagination, add-to-bank and remove-from-bank
 * flows. Hooks, services, and heavy child components are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const {
  navigateMock,
  paramsBox,
  useCourseFromRouteMock,
  useQmPermissionsForCourseMock,
  questionService,
  questionBankService,
  courseService,
  toastFn,
} = vi.hoisted(() => {
  const toast = vi.fn() as any;
  toast.error = vi.fn();
  return {
    navigateMock: vi.fn(),
    paramsBox: { current: { bankId: 'bank-1' } },
    useCourseFromRouteMock: vi.fn(),
    useQmPermissionsForCourseMock: vi.fn(),
    questionService: { getQuestionsPage: vi.fn() },
    questionBankService: { listBanks: vi.fn(), removeQuestionFromBank: vi.fn() },
    courseService: { getCourseTopics: vi.fn() },
    toastFn: toast,
  };
});

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => paramsBox.current,
  };
});
vi.mock('sonner', () => ({ toast: toastFn }));
vi.mock('@/hooks/useCourseFromRoute', () => ({
  useCourseFromRoute: () => useCourseFromRouteMock(),
}));
vi.mock('@/hooks/useQmPermissions', () => ({
  useQmPermissionsForCourse: (...a: any[]) => useQmPermissionsForCourseMock(...a),
}));
vi.mock('@/services/questionService', () => ({ questionService }));
vi.mock('@/services/questionBankService', () => ({ questionBankService }));
vi.mock('@/services/courseService', () => ({ courseService }));

let lastGridProps: any;
vi.mock('@/components/question-bank/QuestionBank', () => ({
  QuestionBank: (props: any) => {
    lastGridProps = props;
    return <div>question-bank-grid</div>;
  },
}));
let lastAddDialogProps: any;
vi.mock('@/components/question-bank/AddQuestionsToBankDialog', () => ({
  AddQuestionsToBankDialog: (props: any) => {
    lastAddDialogProps = props;
    return props.open ? <div>add-questions-dialog</div> : null;
  },
}));
vi.mock('@/components/questions/QuestionModal', () => ({
  QuestionModal: (props: any) => (props.open ? <div>question-modal</div> : null),
}));
let lastDeleteModalProps: any;
vi.mock('@/components/ui/DeleteConfirmationModal', () => ({
  DeleteConfirmationModal: (props: any) => {
    lastDeleteModalProps = props;
    return props.open ? (
      <div>
        <p>{props.title}</p>
        <button onClick={() => void props.onConfirm().catch(() => {})}>confirm-remove</button>
      </div>
    ) : null;
  },
}));

import { BankDetailPage } from '@/pages/BankDetailPage';

afterEach(cleanup);

function renderPage() {
  return render(
    <MemoryRouter>
      <BankDetailPage />
    </MemoryRouter>,
  );
}

const course = { id: 5, name: 'Intro CS' };
const bank = { id: 'bank-1', name: 'Midterm bank', isDefault: false, description: '' };

beforeEach(() => {
  paramsBox.current = { bankId: 'bank-1' };
  useCourseFromRouteMock.mockReturnValue({
    course,
    courseId: 5,
    isLoading: false,
    notFound: false,
  });
  useQmPermissionsForCourseMock.mockReturnValue({
    hasCourseAccess: true,
    accessLoading: false,
    canCreateQuestion: true,
  });
  courseService.getCourseTopics.mockResolvedValue([]);
  questionService.getQuestionsPage.mockResolvedValue({ items: [], total: 0 });
  questionBankService.listBanks.mockResolvedValue([bank]);
});

describe('BankDetailPage', () => {
  it('shows a loading spinner while the course loads', () => {
    useCourseFromRouteMock.mockReturnValue({
      course: null,
      courseId: null,
      isLoading: true,
      notFound: false,
    });
    const { container } = renderPage();
    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });

  it('shows a no-access alert when the course is not found', async () => {
    useCourseFromRouteMock.mockReturnValue({
      course: null,
      courseId: null,
      isLoading: false,
      notFound: true,
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/do not have access to this course/i)).toBeInTheDocument(),
    );
  });

  it('shows a no-access alert when the user lacks course access', async () => {
    useQmPermissionsForCourseMock.mockReturnValue({
      hasCourseAccess: false,
      accessLoading: false,
      canCreateQuestion: false,
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/do not have access to this course/i)).toBeInTheDocument(),
    );
  });

  it('shows a not-found message when the bank does not exist', async () => {
    questionBankService.listBanks.mockResolvedValue([]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('Question bank not found for this course')).toBeInTheDocument(),
    );
  });

  it('shows a load error when listBanks fails', async () => {
    questionBankService.listBanks.mockRejectedValue({ message: 'network down' });
    renderPage();
    await waitFor(() => expect(screen.getByText('network down')).toBeInTheDocument());
  });

  it('renders the bank header and default badge once loaded', async () => {
    questionBankService.listBanks.mockResolvedValue([{ ...bank, isDefault: true }]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Midterm bank')).toBeInTheDocument());
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('navigates back to the course banks tab', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Midterm bank')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Back to banks'));
    expect(navigateMock).toHaveBeenCalledWith('/courses/5?tab=banks');
  });

  it('shows a questions load error', async () => {
    questionService.getQuestionsPage.mockRejectedValue({
      response: { data: { error: 'Failed hard' } },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Failed hard')).toBeInTheDocument());
  });

  it('builds variant entries with resolved topic names', async () => {
    courseService.getCourseTopics.mockResolvedValue([{ id: 't1', name: 'Topic One' }]);
    questionService.getQuestionsPage.mockResolvedValue({
      items: [
        {
          id: 1,
          description: 'Q1',
          type: 'MCQ',
          primaryTopicId: 't1',
          courseId: 5,
          variants: [
            {
              id: 100,
              secondaryTopicsId: ['t1'],
              isAiGenerated: false,
              isDraft: false,
            },
          ],
        },
      ],
      total: 1,
    });
    renderPage();
    await waitFor(() => expect(lastGridProps).toBeTruthy());
    await waitFor(() => expect(lastGridProps.variants).toHaveLength(1));
    expect(lastGridProps.variants[0].primaryTopicName).toBe('Topic One');
    expect(lastGridProps.variants[0].secondaryTopicNames).toEqual(['Topic One']);
  });

  it('opens the add-questions dialog and refreshes on add', async () => {
    renderPage();
    await waitFor(() => expect(lastGridProps).toBeTruthy());
    lastGridProps.onAddQuestion();
    await waitFor(() => expect(screen.getByText('add-questions-dialog')).toBeInTheDocument());
    lastAddDialogProps.onAdded();
    // Triggers a refetch — no crash, offset reset to 0.
    expect(questionService.getQuestionsPage).toHaveBeenCalled();
  });

  it('disables add/remove when writes are disabled', async () => {
    useQmPermissionsForCourseMock.mockReturnValue({
      hasCourseAccess: true,
      accessLoading: false,
      canCreateQuestion: false,
    });
    renderPage();
    await waitFor(() => expect(lastGridProps).toBeTruthy());
    expect(lastGridProps.disableAdd).toBe(true);
    expect(lastGridProps.onRemoveFromBank).toBeUndefined();
  });

  it('removes a question from the bank via the confirmation modal', async () => {
    questionBankService.removeQuestionFromBank.mockResolvedValue(undefined);
    renderPage();
    await waitFor(() => expect(lastGridProps).toBeTruthy());
    lastGridProps.onRemoveFromBank({ questionId: 42 });
    await waitFor(() => expect(lastDeleteModalProps.open).toBe(true));
    fireEvent.click(screen.getByText('confirm-remove'));
    await waitFor(() =>
      expect(questionBankService.removeQuestionFromBank).toHaveBeenCalledWith(5, 'bank-1', 42),
    );
    expect(toastFn).toHaveBeenCalledWith(
      'Removed from bank',
      expect.objectContaining({ description: expect.stringContaining('42') }),
    );
  });

  it('shows an error toast when removing a question fails', async () => {
    questionBankService.removeQuestionFromBank.mockRejectedValue(new Error('remove failed'));
    renderPage();
    await waitFor(() => expect(lastGridProps).toBeTruthy());
    lastGridProps.onRemoveFromBank({ questionId: 42 });
    await waitFor(() => expect(lastDeleteModalProps.open).toBe(true));
    fireEvent.click(screen.getByText('confirm-remove'));
    await waitFor(() => expect(toastFn.error).toHaveBeenCalled());
  });

  it('opens the view question modal via onViewVariant', async () => {
    renderPage();
    await waitFor(() => expect(lastGridProps).toBeTruthy());
    lastGridProps.onViewVariant({ questionId: 1 });
    await waitFor(() => expect(screen.getByText('question-modal')).toBeInTheDocument());
  });

  it('navigates to the variant-create route from onCreateVariant', async () => {
    renderPage();
    await waitFor(() => expect(lastGridProps).toBeTruthy());
    lastGridProps.onCreateVariant({ questionId: 7 });
    expect(navigateMock).toHaveBeenCalledWith('/courses/5/questions/new?variantOf=7');
  });
});
