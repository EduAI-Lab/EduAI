/**
 * #1545 — render + interaction coverage for the question-bank QuestionCard.
 * Covers: base vs. variant identity labels, MCQ correct-choice marking, the
 * kebab menu's permission gating, and firing onView / onCreateVariant.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QuestionCard } from '@/components/question-bank/QuestionCard';
import type { QuestionVariantEntry } from '@/types/question';

const permissionsState = {
  canCreateQuestion: true,
  hasCourseAccess: true,
  accessLoading: false,
  access: 'instructor' as string | null,
};

vi.mock('@/hooks/useQmPermissions', () => ({
  useQmPermissionsForCourse: () => permissionsState,
}));

function baseEntry(overrides: Partial<QuestionVariantEntry> = {}): QuestionVariantEntry {
  return {
    questionId: 42,
    questionDescription: 'Arithmetic',
    questionType: 'MCQ',
    primaryTopicId: '1',
    primaryTopicName: 'Addition',
    courseId: 7,
    isAiGenerated: false,
    isDraft: false,
    variant: {
      id: 100,
      questionText: 'What is 2 + 2?',
      difficulty: 'easy',
      referenceId: null,
      answer: 'B',
      choices: [
        { letter: 'A', text: '3' },
        { letter: 'B', text: '4' },
      ],
      isDraft: false,
      createdAt: '2026-05-01T10:00:00.000Z',
      updatedAt: '2026-05-02T10:00:00.000Z',
    },
    ...overrides,
  } as unknown as QuestionVariantEntry;
}

describe('QuestionCard', () => {
  beforeEach(() => {
    cleanup();
    permissionsState.canCreateQuestion = true;
    permissionsState.hasCourseAccess = true;
    permissionsState.accessLoading = false;
    permissionsState.access = 'instructor';
  });

  it('renders base-question identity, prompt text, and marks the correct MCQ choice', () => {
    render(
      <QuestionCard entry={baseEntry()} questionNumber={1} onView={vi.fn()} onCreateVariant={vi.fn()} />,
    );

    expect(screen.getByText('Question #42')).toBeInTheDocument();
    expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument();
    const correctChoice = screen.getByText('4');
    const incorrectChoice = screen.getByText('3');
    // The correct choice (answer "B" -> "4") gets the success-state styling;
    // the incorrect one gets the default/muted styling. markCorrectChoices is
    // exercised indirectly through this class difference.
    expect(correctChoice.closest('[class*="success"]')).not.toBeNull();
    expect(incorrectChoice.closest('[class*="success"]')).toBeNull();
  });

  it('renders variant identity with its ordinal when referenceId is set', () => {
    render(
      <QuestionCard
        entry={baseEntry({ variant: { ...baseEntry().variant, referenceId: 100 } })}
        questionNumber={1}
        variantNumber={2}
        onView={vi.fn()}
        onCreateVariant={vi.fn()}
      />,
    );

    expect(screen.getByText(/Variant 2/)).toBeInTheDocument();
  });

  it('fires onView when the card is clicked', () => {
    const onView = vi.fn();
    const entry = baseEntry();
    render(<QuestionCard entry={entry} questionNumber={1} onView={onView} onCreateVariant={vi.fn()} />);

    fireEvent.click(screen.getByText('What is 2 + 2?'));
    expect(onView).toHaveBeenCalledWith(entry);
  });

  it('shows the kebab menu and fires onCreateVariant when permitted', async () => {
    const onCreateVariant = vi.fn();
    const entry = baseEntry();
    render(
      <QuestionCard entry={entry} questionNumber={1} onView={vi.fn()} onCreateVariant={onCreateVariant} />,
    );

    const trigger = screen.getByLabelText('Question actions');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(trigger);
    const item = await screen.findByText('Create variant', {}, { timeout: 10000 });
    fireEvent.click(item);

    expect(onCreateVariant).toHaveBeenCalledWith(entry);
  }, 15000);

  it('hides the kebab menu entirely when the user lacks create permission', () => {
    permissionsState.canCreateQuestion = false;
    render(<QuestionCard entry={baseEntry()} questionNumber={1} onView={vi.fn()} onCreateVariant={vi.fn()} />);

    expect(screen.queryByLabelText('Question actions')).not.toBeInTheDocument();
  });

  it('hides the kebab menu while course access is loading', () => {
    permissionsState.accessLoading = true;
    render(<QuestionCard entry={baseEntry()} questionNumber={1} onView={vi.fn()} onCreateVariant={vi.fn()} />);

    expect(screen.queryByLabelText('Question actions')).not.toBeInTheDocument();
  });

  it('appends a TA access-level topic chip when access is "ta"', () => {
    permissionsState.access = 'ta';
    render(<QuestionCard entry={baseEntry()} questionNumber={1} onView={vi.fn()} onCreateVariant={vi.fn()} />);

    expect(screen.getByText(/own edits only/i)).toBeInTheDocument();
  });

  it('renders short-answer question types with the plain answer instead of choices', () => {
    const entry = baseEntry({
      questionType: 'SA',
      variant: {
        id: 101,
        questionText: 'Explain gravity.',
        difficulty: 'hard',
        referenceId: null,
        answer: 'Objects with mass attract each other.',
        choices: null,
      },
    } as Partial<QuestionVariantEntry>);
    render(<QuestionCard entry={entry} questionNumber={2} onView={vi.fn()} onCreateVariant={vi.fn()} />);

    expect(screen.getByText('Explain gravity.')).toBeInTheDocument();
    expect(screen.getByText('Objects with mass attract each other.')).toBeInTheDocument();
  });
});
