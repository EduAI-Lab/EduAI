/**
 * @vitest-environment jsdom
 *
 * Add-to-bank dialog: questions already in the bank are shown but not selectable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AddQuestionsToBankDialog } from './AddQuestionsToBankDialog';
import type { Question } from '../../types/question';

const { toast } = vi.hoisted(() => {
  const toastFn = Object.assign(vi.fn(), { error: vi.fn() });
  return { toast: toastFn };
});

vi.mock('sonner', () => ({
  toast,
}));

vi.mock('../../services/questionService', () => ({
  questionService: {
    getQuestionsPage: vi.fn(),
  },
}));

vi.mock('../../services/questionBankService', () => ({
  questionBankService: {
    addQuestionToBank: vi.fn(),
  },
}));

import { questionService } from '../../services/questionService';
import { questionBankService } from '../../services/questionBankService';

function makeQuestion(id: number, text: string): Question {
  return {
    id,
    description: null,
    type: 'SA',
    courseId: 9,
    primaryTopicId: 'topic_1',
    questionOrder: null,
    createdAt: '',
    updatedAt: '',
    variants: [
      {
        id: id * 10,
        questionText: text,
        difficulty: 'medium',
        assessmentId: null,
        secondaryTopicsId: null,
        referenceId: null,
        answer: null,
      },
    ],
  };
}

describe('AddQuestionsToBankDialog', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    vi.mocked(questionService.getQuestionsPage).mockImplementation(async (opts: any) => {
      if (opts?.questionBankId) {
        return { items: [makeQuestion(1, 'Already in bank')], total: 1 };
      }
      return {
        items: [
          makeQuestion(1, 'Already in bank'),
          makeQuestion(2, 'Available question'),
        ],
        total: 2,
      };
    });
    vi.mocked(questionBankService.addQuestionToBank).mockResolvedValue(undefined as any);
  });

  it('disables checkboxes for questions already in the bank', async () => {
    render(
      <AddQuestionsToBankDialog
        open
        onClose={vi.fn()}
        courseId={9}
        bankId="bank_1"
        bankName="Extra"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('add-to-bank-question-list')).toBeInTheDocument();
    });

    expect(screen.getByText('In Bank')).toBeInTheDocument();

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toBeDisabled();
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeDisabled();
    expect(checkboxes[1]).not.toBeChecked();
  });

  it('adds only newly selected questions', async () => {
    const onAdded = vi.fn();
    const onClose = vi.fn();

    render(
      <AddQuestionsToBankDialog
        open
        onClose={onClose}
        courseId={9}
        bankId="bank_1"
        bankName="Extra"
        onAdded={onAdded}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('add-to-bank-question-list')).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);

    fireEvent.click(screen.getByTestId('add-to-bank-confirm'));

    await waitFor(() => {
      expect(questionBankService.addQuestionToBank).toHaveBeenCalledTimes(1);
      expect(questionBankService.addQuestionToBank).toHaveBeenCalledWith(9, 'bank_1', 2);
      expect(onAdded).toHaveBeenCalledWith(1);
      expect(onClose).toHaveBeenCalled();
    });
  });
});
