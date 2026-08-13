import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AssessmentBuilder } from '@/components/assessments/AssessmentBuilder';
import type { Assessment } from '@/types/question';

const assessment = {
  id: 10,
  sections: [
    { id: 1, name: 'A', position: 0, sectionVariants: [] },
    { id: 2, name: 'B', position: 1, sectionVariants: [] },
  ],
} as unknown as Assessment;

describe('AssessmentBuilder reorder', () => {
  beforeEach(() => cleanup());

  it('emits full sectionIds when moving a section down', async () => {
    const onReorderSections = vi.fn().mockResolvedValue(undefined);
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
    await waitFor(() => {
      expect(onReorderSections).toHaveBeenCalledWith([2, 1]);
    });
  });

  it('disables move controls while a reorder is pending', async () => {
    let resolveReorder!: () => void;
    const onReorderSections = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveReorder = resolve;
        }),
    );
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
    const down = screen.getAllByRole('button', { name: /move section down/i })[0];
    expect(down).not.toBeDisabled();
    fireEvent.click(down);
    await waitFor(() => expect(onReorderSections).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(down).toBeDisabled());
    fireEvent.click(down);
    expect(onReorderSections).toHaveBeenCalledTimes(1);
    resolveReorder();
    await waitFor(() => expect(down).not.toBeDisabled());
  });
});
