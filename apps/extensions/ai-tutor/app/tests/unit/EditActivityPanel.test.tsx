import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EditActivityPanel from '~/components/EditActivityPanel';
import type { Activity } from '~/lib/types';

function baseActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 7,
    title: null,
    instructionsMd: '',
    position: 0,
    question: 'What is 2+2?',
    type: 'MCQ',
    options: { choices: ['3', '4'] },
    answer: { correctIndex: 1 },
    hints: [],
    mainTopic: null,
    secondaryTopics: [],
    enableTeachMode: true,
    enableGuideMode: true,
    enableCustomMode: false,
    customPrompt: null,
    customPromptTitle: null,
    ...overrides,
  };
}

describe('EditActivityPanel', () => {
  it('renders the current question and choices, with the correct answer marked', () => {
    render(
      <EditActivityPanel activity={baseActivity()} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(screen.getByDisplayValue('What is 2+2?')).toBeInTheDocument();
    expect(screen.getByLabelText('Option A')).toHaveValue('3');
    expect(screen.getByLabelText('Option B')).toHaveValue('4');
    expect(screen.getByLabelText('Option B (correct answer)')).toBeInTheDocument();
  });

  it('submits the built payload for an MCQ activity', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <EditActivityPanel activity={baseActivity()} onSubmit={onSubmit} onCancel={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'What is 2+2?',
        type: 'MCQ',
        options: ['3', '4'],
        answer: { correctIndex: 1 },
      }),
    );
  });

  it('shows a validation error and does not submit for an invalid form', () => {
    const onSubmit = vi.fn();
    render(
      <EditActivityPanel
        activity={baseActivity({ options: { choices: ['only-one'] }, answer: { correctIndex: 0 } })}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(screen.getByText('Provide at least two answer choices.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('switches to SHORT_TEXT and submits a text-answer payload', () => {
    const onSubmit = vi.fn();
    render(
      <EditActivityPanel activity={baseActivity()} onSubmit={onSubmit} onCancel={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Short answer' }));
    fireEvent.change(screen.getByPlaceholderText('Ideal short response'), {
      target: { value: 'Four' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SHORT_TEXT', answer: { text: 'Four' }, options: null }),
    );
  });

  it('adds and removes MCQ choices, keeping at least two', () => {
    render(
      <EditActivityPanel activity={baseActivity()} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add choice' }));
    expect(screen.getByLabelText('Option E')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove option E' }));
    expect(screen.queryByLabelText('Option E')).not.toBeInTheDocument();
  });

  it('marks a newly clicked option as correct', () => {
    render(
      <EditActivityPanel activity={baseActivity()} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );

    fireEvent.click(screen.getByLabelText('Mark option A correct'));
    expect(screen.getByLabelText('Option A (correct answer)')).toBeInTheDocument();
  });

  it('calls onCancel and resets the form when Cancel is clicked', () => {
    const onCancel = vi.fn();
    render(
      <EditActivityPanel activity={baseActivity()} onSubmit={vi.fn()} onCancel={onCancel} />,
    );

    fireEvent.change(screen.getByDisplayValue('What is 2+2?'), {
      target: { value: 'Changed question' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows the busy label and disables actions while saving', () => {
    render(
      <EditActivityPanel activity={baseActivity()} onSubmit={vi.fn()} busy onCancel={vi.fn()} />,
    );

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('displays an external error message', () => {
    render(
      <EditActivityPanel
        activity={baseActivity()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        error="Server rejected the update."
      />,
    );
    expect(screen.getByText('Server rejected the update.')).toBeInTheDocument();
  });

  it('resets to the new activity when the activity prop changes', () => {
    const { rerender } = render(
      <EditActivityPanel activity={baseActivity()} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );

    const nextActivity = baseActivity({ id: 8, question: 'A different question' });
    rerender(
      <EditActivityPanel activity={nextActivity} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(screen.getByDisplayValue('A different question')).toBeInTheDocument();
  });
});
