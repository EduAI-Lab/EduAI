/**
 * #1120 — the review-status toggle in the section kebab must confirm before it fires.
 * Cancelling has to leave status untouched and issue no callback at all.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
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

describe('AssessmentSectionCard review-status confirmation', () => {
  beforeEach(() => cleanup());

  it('does not fire the toggle on menu click alone', async () => {
    const onToggleDraft = vi.fn();
    renderCard(true, onToggleDraft);

    await openToggleItem('Mark reviewed');

    expect(onToggleDraft).not.toHaveBeenCalled();
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });

  it('fires exactly one toggle when confirmed', async () => {
    const onToggleDraft = vi.fn();
    renderCard(true, onToggleDraft);

    await openToggleItem('Mark reviewed');
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark as reviewed' }));

    expect(onToggleDraft).toHaveBeenCalledTimes(1);
    // draft -> reviewed means nextDraft === false
    expect(onToggleDraft.mock.calls[0][1]).toBe(false);
  });

  it('fires nothing when cancelled', async () => {
    const onToggleDraft = vi.fn();
    renderCard(true, onToggleDraft);

    await openToggleItem('Mark reviewed');
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(onToggleDraft).not.toHaveBeenCalled();
  });

  it('uses the demotion copy when moving a reviewed question back to draft', async () => {
    const onToggleDraft = vi.fn();
    renderCard(false, onToggleDraft);

    await openToggleItem('Mark as draft');
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/excluded from export/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Move to draft' }));
    expect(onToggleDraft).toHaveBeenCalledTimes(1);
    // reviewed -> draft means nextDraft === true
    expect(onToggleDraft.mock.calls[0][1]).toBe(true);
  });
});
