import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AssessmentSectionCard } from '@/components/assessments/AssessmentSectionCard';
import type { AssessmentSection, SectionVariantLink, QuestionVariantEntry } from '@/types/question';

const section = { id: 1, name: 'Section A', position: 2 } as unknown as AssessmentSection;

function renderCard(props: Partial<React.ComponentProps<typeof AssessmentSectionCard>> = {}) {
  return render(
    <AssessmentSectionCard
      section={section}
      sectionIndex={1}
      questionLinks={[] as SectionVariantLink[]}
      questionBank={[] as QuestionVariantEntry[]}
      onUpdateTitle={vi.fn()}
      onRemoveQuestion={vi.fn()}
      onDeleteSection={vi.fn()}
      onAddQuestions={vi.fn()}
      canMoveUp
      canMoveDown
      onMoveUp={vi.fn()}
      onMoveDown={vi.fn()}
      {...props}
    />,
  );
}

describe('AssessmentSectionCard reorder controls', () => {
  beforeEach(() => cleanup());

  it('calls onMoveUp / onMoveDown when enabled', () => {
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    renderCard({ onMoveUp, onMoveDown, canMoveUp: true, canMoveDown: true });
    fireEvent.click(screen.getByRole('button', { name: /move section up/i }));
    fireEvent.click(screen.getByRole('button', { name: /move section down/i }));
    expect(onMoveUp).toHaveBeenCalledOnce();
    expect(onMoveDown).toHaveBeenCalledOnce();
  });

  it('disables end buttons', () => {
    renderCard({ canMoveUp: false, canMoveDown: false });
    expect(screen.getByRole('button', { name: /move section up/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /move section down/i })).toBeDisabled();
  });

  it('hides reorder controls when readOnly', () => {
    renderCard({ readOnly: true });
    expect(screen.queryByRole('button', { name: /move section up/i })).toBeNull();
  });
});
