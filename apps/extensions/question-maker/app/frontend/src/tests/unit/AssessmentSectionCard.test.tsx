/**
 * Unit tests for AssessmentSectionCard (#1545): title editing, the per-question
 * kebab menu (view/new-variant/remove), delete-section, and the empty-section
 * readOnly vs writable branches. Reorder and review-confirm behavior are
 * covered by the existing Reorder/ReviewConfirm test files.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssessmentSectionCard } from '@/components/assessments/AssessmentSectionCard';
import type { AssessmentSection, SectionVariantLink, QuestionVariantEntry } from '@/types/question';

afterEach(cleanup);

const section = { id: 1, name: 'Section A' } as AssessmentSection;
const questionLinks = [{ id: 5, variantId: 10 }] as SectionVariantLink[];
const entry = {
  questionId: 3,
  primaryTopicName: 'Topic A',
  isDraft: false,
  questionType: 'MCQ',
  variant: { id: 10, questionText: 'What is 2 + 2?', difficulty: 'easy', isDraft: false },
} as QuestionVariantEntry;

function renderCard(props: Partial<React.ComponentProps<typeof AssessmentSectionCard>> = {}) {
  return render(
    <AssessmentSectionCard
      section={section}
      sectionIndex={0}
      questionLinks={questionLinks}
      questionBank={[entry]}
      onUpdateTitle={vi.fn()}
      onRemoveQuestion={vi.fn()}
      onDeleteSection={vi.fn()}
      onAddQuestions={vi.fn()}
      {...props}
    />,
  );
}

async function openMenu() {
  const trigger = screen.getByLabelText('Question actions');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.click(trigger);
}

describe('AssessmentSectionCard', () => {
  it('renders the question and topic', () => {
    renderCard();
    expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument();
    expect(screen.getByText('Topic A')).toBeInTheDocument();
  });

  it('updates the section title on blur when changed', () => {
    const onUpdateTitle = vi.fn();
    renderCard({ onUpdateTitle });
    const input = screen.getByPlaceholderText('Section 1');
    fireEvent.change(input, { target: { value: 'Renamed section' } });
    fireEvent.blur(input);
    expect(onUpdateTitle).toHaveBeenCalledWith('Renamed section');
  });

  it('does not call onUpdateTitle when the value is unchanged', () => {
    const onUpdateTitle = vi.fn();
    renderCard({ onUpdateTitle });
    const input = screen.getByPlaceholderText('Section 1');
    fireEvent.blur(input);
    expect(onUpdateTitle).not.toHaveBeenCalled();
  });

  it('falls back to the previous name when blurred empty', () => {
    const onUpdateTitle = vi.fn();
    renderCard({ onUpdateTitle });
    const input = screen.getByPlaceholderText('Section 1');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(onUpdateTitle).not.toHaveBeenCalled();
  });

  it('calls onDeleteSection', () => {
    const onDeleteSection = vi.fn();
    renderCard({ onDeleteSection });
    fireEvent.click(screen.getByLabelText('Delete section'));
    expect(onDeleteSection).toHaveBeenCalled();
  });

  it('hides the delete button when readOnly', () => {
    renderCard({ readOnly: true });
    expect(screen.queryByLabelText('Delete section')).not.toBeInTheDocument();
  });

  it('shows a readOnly empty message when there are no questions', () => {
    renderCard({ questionLinks: [], readOnly: true });
    expect(screen.getByText('No questions in this section.')).toBeInTheDocument();
  });

  it('calls onViewQuestion from the kebab menu', async () => {
    const onViewQuestion = vi.fn();
    renderCard({ onViewQuestion });
    await openMenu();
    fireEvent.click(await screen.findByText('View'));
    await waitFor(() => expect(onViewQuestion).toHaveBeenCalledWith(entry));
  });

  it('calls onCreateVariant from the kebab menu', async () => {
    const onCreateVariant = vi.fn();
    renderCard({ onCreateVariant });
    await openMenu();
    fireEvent.click(await screen.findByText('New variant'));
    await waitFor(() => expect(onCreateVariant).toHaveBeenCalledWith(entry));
  });

  it('calls onRemoveQuestion from the kebab menu', async () => {
    const onRemoveQuestion = vi.fn();
    renderCard({ onRemoveQuestion });
    await openMenu();
    fireEvent.click(await screen.findByText('Remove from section'));
    expect(onRemoveQuestion).toHaveBeenCalledWith(10);
  });

  it('does not show manage-only menu items when readOnly', async () => {
    const onViewQuestion = vi.fn();
    renderCard({ readOnly: true, onViewQuestion, onCreateVariant: vi.fn(), onToggleDraft: vi.fn() });
    await openMenu();
    expect(await screen.findByText('View')).toBeInTheDocument();
    expect(screen.queryByText('New variant')).not.toBeInTheDocument();
    expect(screen.queryByText('Remove from section')).not.toBeInTheDocument();
  });
});
