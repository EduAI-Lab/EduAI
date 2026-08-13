/**
 * @vitest-environment jsdom
 *
 * Bank detail page (#845) — load bank/questions, not-found, back nav.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import BankDetailPage from './BankDetailPage';

const navigate = vi.fn();
const { toast } = vi.hoisted(() => {
  const toastFn = Object.assign(vi.fn(), { error: vi.fn() });
  return { toast: toastFn };
});

vi.mock('sonner', () => ({
  toast,
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock('sonner', () => ({
  toast,
}));

vi.mock('../hooks/useCourseFromRoute', () => ({
  useCourseFromRoute: () => ({
    course: { id: 9, name: 'CS 101', code: 'CS101' },
    courseId: 9,
    isLoading: false,
    notFound: false,
  }),
}));

vi.mock('../hooks/useQmPermissions', () => ({
  useQmPermissionsForCourse: () => ({
    hasCourseAccess: true,
    accessLoading: false,
    canCreateQuestion: true,
  }),
}));

vi.mock('../services/questionBankService', () => ({
  questionBankService: {
    listBanks: vi.fn(),
    removeQuestionFromBank: vi.fn(),
  },
}));

vi.mock('../services/questionService', () => ({
  questionService: {
    getQuestionsPage: vi.fn(),
  },
}));

vi.mock('../services/courseService', () => ({
  courseService: {
    getCourseTopics: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../components/question-bank/QuestionBank', () => ({
  QuestionBank: ({ emptyMessage, onAddQuestion, onRemoveFromBank, variants }: any) => (
    <div data-testid="question-bank-grid">
      <p>{emptyMessage}</p>
      <button type="button" onClick={onAddQuestion}>
        Add question
      </button>
      {variants?.map((v: any) => (
        <button
          key={v.questionId}
          type="button"
          onClick={() => onRemoveFromBank?.(v)}
        >
          Remove {v.questionId}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../components/question-bank/AddQuestionsToBankDialog', () => ({
  AddQuestionsToBankDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="add-dialog-open" /> : null,
}));

vi.mock('../components/questions/QuestionModal', () => ({
  QuestionModal: () => null,
}));

vi.mock('../components/ui/DeleteConfirmationModal', () => ({
  DeleteConfirmationModal: ({ open, onConfirm, title }: any) =>
    open ? (
      <div data-testid="remove-confirm">
        <span>{title}</span>
        <button type="button" onClick={() => void onConfirm()}>
          Confirm remove
        </button>
      </div>
    ) : null,
}));

import { questionBankService } from '../services/questionBankService';
import { questionService } from '../services/questionService';

function renderPage(bankId = 'bank_1') {
  return render(
    <MemoryRouter initialEntries={[`/courses/9/banks/${bankId}`]}>
      <Routes>
        <Route path="/courses/:courseId/banks/:bankId" element={<BankDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('BankDetailPage', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    vi.mocked(questionBankService.listBanks).mockResolvedValue([
      {
        id: 'bank_1',
        courseId: 9,
        name: 'Midterm',
        description: 'Prep',
        isDefault: false,
      },
    ]);
    vi.mocked(questionService.getQuestionsPage).mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    });
  });

  it('loads the bank and shows its name', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Midterm' })).toBeInTheDocument();
    });
    expect(questionBankService.listBanks).toHaveBeenCalledWith(9);
    expect(questionService.getQuestionsPage).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 9, questionBankId: 'bank_1' }),
    );
  });

  it('shows not found when the bank id is missing from the course', async () => {
    vi.mocked(questionBankService.listBanks).mockResolvedValue([]);
    renderPage('missing');
    await waitFor(() => {
      expect(screen.getByText(/Question bank not found/i)).toBeInTheDocument();
    });
  });

  it('navigates back to the banks tab', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Midterm' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Back to banks/i }));
    expect(navigate).toHaveBeenCalledWith('/courses/9?tab=banks');
  });

  it('opens the add-questions dialog', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('question-bank-grid')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add question' }));
    expect(screen.getByTestId('add-dialog-open')).toBeInTheDocument();
  });
});
