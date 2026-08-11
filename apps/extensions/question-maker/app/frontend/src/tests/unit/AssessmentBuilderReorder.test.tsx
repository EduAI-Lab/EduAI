import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssessmentBuilder } from '@/components/assessments/AssessmentBuilder';
import type { Assessment } from '@/types/question';

const assessment = {
  id: 10,
  sections: [
    { id: 1, name: 'A', position: 1, sectionVariants: [] },
    { id: 2, name: 'B', position: 2, sectionVariants: [] },
  ],
} as unknown as Assessment;

describe('AssessmentBuilder reorder', () => {
  it('emits full sectionIds when moving a section down', () => {
    const onReorderSections = vi.fn();
    render(
      <AssessmentBuilder
        assessment={assessment}
        questionBank={[]}
        topics={[]}
        onAddSection={vi.fn()}
        onUpdateSectionName={vi.fn()}
        onDeleteSection={vi.fn()}
        onAddQuestionsToSection={vi.fn()}
        onRemoveQuestionFromSection={vi.fn()}
        onReorderSections={onReorderSections}
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: /move section down/i })[0]);
    expect(onReorderSections).toHaveBeenCalledWith([2, 1]);
  });
});
