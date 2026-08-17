/**
 * Review-status actions are immediate: both the kebab action and the quick action
 * write without an intermediate confirmation dialog.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AssessmentSectionCard } from '@/components/assessments/AssessmentSectionCard';
import type {
  AssessmentSection,
  SectionVariantLink,
  QuestionVariantEntry,
} from '@/types/question';

const section = { id: 1, name: 'Section A' } as unknown as AssessmentSection;
const questionLinks = [{ variantId: 10 }] as unknown as SectionVariantLink[];

function makeEntry(isDraft: boolean): QuestionVariantEntry {
  return {
    isDraft,
    variant: {
      id: 10,
      questionText: 'What is 2 + 2?',
      difficulty: 'easy',
      isDraft,
    },
  } as unknown as QuestionVariantEntry;
}

function renderCard(isDraft: boolean, onToggleDraft: ReturnType<typeof vi.fn>) {
  return render(
    <AssessmentSectionCard
      section={section}
      sectionIndex={0}
      questionLinks={questionLinks}
      questionBank={[makeEntry(isDraft)]}
      onUpdateTitle={vi.fn()}
      onRemoveQuestion={vi.fn()}
      onDeleteSection={vi.fn()}
      onAddQuestions={vi.fn()}
      onToggleDraft={onToggleDraft}
    />,
  );
}

/**
 * Radix opens the kebab on pointerdown, which jsdom does not synthesise from a plain
 * click — fire it explicitly, then select the item by its label.
 */
async function openToggleItem(label: string) {
  const trigger = screen.getByLabelText('Question actions');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.click(trigger);
  const item = await screen.findByText(label);
  fireEvent.click(item);
}

describe('AssessmentSectionCard review-status actions', () => {
  beforeEach(() => cleanup());

  it('fires the toggle directly from the menu', async () => {
    const onToggleDraft = vi.fn();
    renderCard(true, onToggleDraft);

    await openToggleItem('Mark reviewed');

    expect(onToggleDraft).toHaveBeenCalledWith(expect.anything(), false);
  });

  it('fires the quick action directly', () => {
    const onToggleDraft = vi.fn();
    renderCard(true, onToggleDraft);

    fireEvent.click(screen.getByRole('button', { name: 'Mark question 1 as reviewed' }));

    expect(onToggleDraft).toHaveBeenCalledTimes(1);
    expect(onToggleDraft.mock.calls[0][1]).toBe(false);
  });

  it('moves a reviewed question back to draft directly', async () => {
    const onToggleDraft = vi.fn();
    renderCard(false, onToggleDraft);

    await openToggleItem('Mark as draft');
    expect(onToggleDraft).toHaveBeenCalledTimes(1);
    expect(onToggleDraft.mock.calls[0][1]).toBe(true);
  });
});
