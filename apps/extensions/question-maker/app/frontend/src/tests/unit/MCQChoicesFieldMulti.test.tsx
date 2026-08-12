/**
 * #1360 — MCQChoicesField select-all-that-apply toggle and multi-mark clicks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MCQChoicesField } from '../../components/questions/MCQChoicesField';
import type { MCQChoice } from '../../types/question';

const CHOICES: MCQChoice[] = [
  { letter: 'A', text: 'One' },
  { letter: 'B', text: 'Two' },
  { letter: 'C', text: 'Three' },
  { letter: 'D', text: 'Four' },
];

afterEach(() => {
  cleanup();
});

describe('MCQChoicesField multi-correct (#1360)', () => {
  it('toggle off: clicking letter B calls onAnswerChange with B', () => {
    const onAnswerChange = vi.fn();
    const onChoicesChange = vi.fn();

    render(
      <MCQChoicesField
        choices={CHOICES}
        answer=""
        onChoicesChange={onChoicesChange}
        onAnswerChange={onAnswerChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Mark option B correct/i }));
    expect(onAnswerChange).toHaveBeenCalledWith('B');
  });

  it('toggle on: clicking A then C calls onCorrectAnswersChange with both', () => {
    const onAnswerChange = vi.fn();
    const onChoicesChange = vi.fn();
    const onCorrectAnswersChange = vi.fn();
    const onSelectAllThatApplyChange = vi.fn();

    const { rerender } = render(
      <MCQChoicesField
        choices={CHOICES}
        answer=""
        selectAllThatApply={true}
        correctAnswers={[]}
        onChoicesChange={onChoicesChange}
        onAnswerChange={onAnswerChange}
        onCorrectAnswersChange={onCorrectAnswersChange}
        onSelectAllThatApplyChange={onSelectAllThatApplyChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Mark option A correct/i }));
    expect(onCorrectAnswersChange).toHaveBeenCalledWith(['A']);
    expect(onAnswerChange).toHaveBeenCalledWith('A');

    rerender(
      <MCQChoicesField
        choices={CHOICES}
        answer="A"
        selectAllThatApply={true}
        correctAnswers={['A']}
        onChoicesChange={onChoicesChange}
        onAnswerChange={onAnswerChange}
        onCorrectAnswersChange={onCorrectAnswersChange}
        onSelectAllThatApplyChange={onSelectAllThatApplyChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Mark option C correct/i }));
    expect(onCorrectAnswersChange).toHaveBeenLastCalledWith(['A', 'C']);
    expect(onAnswerChange).toHaveBeenLastCalledWith('A');
  });

  it('updates hint text when select-all-that-apply is on', () => {
    const onAnswerChange = vi.fn();
    const onChoicesChange = vi.fn();

    const { rerender } = render(
      <MCQChoicesField
        choices={CHOICES}
        answer=""
        onChoicesChange={onChoicesChange}
        onAnswerChange={onAnswerChange}
      />,
    );

    expect(screen.getByText('Click a letter to mark the correct answer')).toBeInTheDocument();

    rerender(
      <MCQChoicesField
        choices={CHOICES}
        answer=""
        selectAllThatApply={true}
        correctAnswers={[]}
        onChoicesChange={onChoicesChange}
        onAnswerChange={onAnswerChange}
      />,
    );

    expect(screen.getByText('Click letters to mark all correct answers')).toBeInTheDocument();
    expect(screen.queryByText('Click a letter to mark the correct answer')).not.toBeInTheDocument();
  });
});
