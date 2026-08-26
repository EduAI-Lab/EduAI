/**
 * Coverage for MCQChoicesField (#1545) — a self-contained choices editor with no
 * service dependencies: default choices, marking the correct answer, add/remove,
 * min/max bounds, and the disabled state.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MCQChoicesField } from '@/components/questions/MCQChoicesField';
import type { MCQChoice } from '@/types/question';

const choices: MCQChoice[] = [
  { letter: 'A', text: 'Paris' },
  { letter: 'B', text: 'Berlin' },
  { letter: 'C', text: 'Rome' },
];

describe('MCQChoicesField', () => {
  beforeEach(() => cleanup());

  it('falls back to four blank default choices when none are given', () => {
    render(
      <MCQChoicesField choices={null} answer="" onChoicesChange={vi.fn()} onAnswerChange={vi.fn()} />,
    );

    ['A', 'B', 'C', 'D'].forEach((letter) => {
      expect(screen.getByLabelText(`Option ${letter}`)).toHaveValue('');
    });
    expect(screen.getByText('No correct answer selected yet.')).toBeInTheDocument();
  });

  it('marks a choice correct when its letter button is clicked', () => {
    const onAnswerChange = vi.fn();
    render(
      <MCQChoicesField
        choices={choices}
        answer=""
        onChoicesChange={vi.fn()}
        onAnswerChange={onAnswerChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mark option B correct' }));
    expect(onAnswerChange).toHaveBeenCalledWith('B');
  });

  it('shows the correct answer styling and label for the selected letter', () => {
    render(
      <MCQChoicesField
        choices={choices}
        answer="B"
        onChoicesChange={vi.fn()}
        onAnswerChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Option B (correct answer)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByText('No correct answer selected yet.')).not.toBeInTheDocument();
  });

  it('updates choice text via onChoicesChange', () => {
    const onChoicesChange = vi.fn();
    render(
      <MCQChoicesField
        choices={choices}
        answer=""
        onChoicesChange={onChoicesChange}
        onAnswerChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Option A'), { target: { value: 'Paris, France' } });
    expect(onChoicesChange).toHaveBeenCalledWith([
      { letter: 'A', text: 'Paris, France' },
      { letter: 'B', text: 'Berlin' },
      { letter: 'C', text: 'Rome' },
    ]);
  });

  it('adds a new lettered choice up to the 8-choice cap', () => {
    const onChoicesChange = vi.fn();
    render(
      <MCQChoicesField
        choices={choices}
        answer=""
        onChoicesChange={onChoicesChange}
        onAnswerChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '+ Add Choice' }));
    expect(onChoicesChange).toHaveBeenCalledWith([...choices, { letter: 'D', text: '' }]);
  });

  it('hides Add Choice once there are 8 choices', () => {
    const eight: MCQChoice[] = Array.from({ length: 8 }, (_, i) => ({
      letter: String.fromCharCode(65 + i),
      text: `Choice ${i}`,
    }));
    render(
      <MCQChoicesField choices={eight} answer="" onChoicesChange={vi.fn()} onAnswerChange={vi.fn()} />,
    );

    expect(screen.queryByRole('button', { name: '+ Add Choice' })).not.toBeInTheDocument();
  });

  it('removes a choice and re-letters the remaining ones', () => {
    const onChoicesChange = vi.fn();
    render(
      <MCQChoicesField
        choices={choices}
        answer=""
        onChoicesChange={onChoicesChange}
        onAnswerChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove option B' }));
    expect(onChoicesChange).toHaveBeenCalledWith([
      { letter: 'A', text: 'Paris' },
      { letter: 'B', text: 'Rome' },
    ]);
  });

  it('clears the answer when the removed choice was the correct one', () => {
    const onAnswerChange = vi.fn();
    render(
      <MCQChoicesField
        choices={choices}
        answer="B"
        onChoicesChange={vi.fn()}
        onAnswerChange={onAnswerChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove option B' }));
    expect(onAnswerChange).toHaveBeenCalledWith('');
  });

  it('hides remove buttons once only two choices remain', () => {
    const two: MCQChoice[] = [
      { letter: 'A', text: 'Yes' },
      { letter: 'B', text: 'No' },
    ];
    render(
      <MCQChoicesField choices={two} answer="" onChoicesChange={vi.fn()} onAnswerChange={vi.fn()} />,
    );

    expect(screen.queryByRole('button', { name: /remove option/i })).not.toBeInTheDocument();
  });

  it('disables all interactive controls when disabled', () => {
    render(
      <MCQChoicesField
        choices={choices}
        answer=""
        onChoicesChange={vi.fn()}
        onAnswerChange={vi.fn()}
        disabled
      />,
    );

    expect(screen.getByRole('button', { name: 'Mark option A correct' })).toBeDisabled();
    expect(screen.getByLabelText('Option A')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove option A' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '+ Add Choice' })).toBeDisabled();
  });

  it('renders a custom choices label', () => {
    render(
      <MCQChoicesField
        choices={choices}
        answer=""
        onChoicesChange={vi.fn()}
        onAnswerChange={vi.fn()}
        choicesLabel="Answer options"
      />,
    );

    expect(screen.getByText('Answer options')).toBeInTheDocument();
  });
});
