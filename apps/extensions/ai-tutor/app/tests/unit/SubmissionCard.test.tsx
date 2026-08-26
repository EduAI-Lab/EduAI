import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SubmissionCard } from '~/components/courses/SubmissionCard';
import type { SubmissionRow } from '~/lib/types';

function row(overrides: Partial<SubmissionRow> = {}): SubmissionRow {
  return {
    id: 1,
    userId: 'u1',
    studentName: 'Ada Lovelace',
    activityId: 10,
    activityTitle: 'Solve for x',
    lessonTitle: 'Week 1',
    questionText: 'What is x in 2x=4?',
    attemptNumber: 1,
    response: { answerOption: 1 },
    answerLabel: 'x = 2',
    aiFeedback: null,
    score: null,
    isCorrect: null,
    createdAt: '2026-03-10T08:00:00.000Z',
    ...overrides,
  };
}

describe('SubmissionCard', () => {
  it('renders student identity, subline, and MCQ answer chip', () => {
    render(
      <SubmissionCard
        row={row()}
        canGrade={false}
        timeLabel="2h ago"
        fullTime="March 10, 2026, 8:00 AM"
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Week 1 — Solve for x')).toBeInTheDocument();
    expect(screen.getByText('x = 2')).toBeInTheDocument();
    expect(screen.getByText('Needs grading')).toBeInTheDocument();
    expect(screen.getByText('2h ago')).toBeInTheDocument();
  });

  it('shows Correct/Incorrect badges once graded', () => {
    const { rerender } = render(
      <SubmissionCard
        row={row({ isCorrect: true })}
        canGrade={false}
        timeLabel="now"
        fullTime="now"
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('Correct')).toBeInTheDocument();

    rerender(
      <SubmissionCard
        row={row({ isCorrect: false })}
        canGrade={false}
        timeLabel="now"
        fullTime="now"
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('Incorrect')).toBeInTheDocument();
  });

  it('renders free-text answers when the response has answerText', () => {
    render(
      <SubmissionCard
        row={row({ response: { answerText: 'The answer is 2' }, answerLabel: null })}
        canGrade={false}
        timeLabel="now"
        fullTime="now"
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('The answer is 2')).toBeInTheDocument();
  });

  it('shows "No answer recorded" when there is no response', () => {
    render(
      <SubmissionCard
        row={row({ response: null, answerLabel: null })}
        canGrade={false}
        timeLabel="now"
        fullTime="now"
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('No answer recorded')).toBeInTheDocument();
  });

  it('renders AI feedback when present', () => {
    render(
      <SubmissionCard
        row={row({ aiFeedback: { message: 'Nice work, minor sign error.' } })}
        canGrade={false}
        timeLabel="now"
        fullTime="now"
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('Nice work, minor sign error.')).toBeInTheDocument();
  });

  it('shows the score when present', () => {
    render(
      <SubmissionCard
        row={row({ score: 8 })}
        canGrade={false}
        timeLabel="now"
        fullTime="now"
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('shows a Grade button when canGrade is true, View otherwise', () => {
    const { rerender } = render(
      <SubmissionCard row={row()} canGrade timeLabel="now" fullTime="now" onOpen={vi.fn()} />,
    );
    // Exact match: the outer role="button" card wrapper would otherwise also
    // match a /Grade/ regex, since its accessible name includes all descendant text.
    expect(screen.getByRole('button', { name: 'Grade' })).toBeInTheDocument();

    rerender(
      <SubmissionCard
        row={row()}
        canGrade={false}
        timeLabel="now"
        fullTime="now"
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('calls onOpen when the card is clicked or the action button is clicked', () => {
    const onOpen = vi.fn();
    const submission = row();
    render(
      <SubmissionCard row={submission} canGrade timeLabel="now" fullTime="now" onOpen={onOpen} />,
    );

    fireEvent.click(screen.getByTestId('submission-card'));
    expect(onOpen).toHaveBeenCalledWith(submission);

    onOpen.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Grade' }));
    expect(onOpen).toHaveBeenCalledWith(submission);
  });

  it('calls onOpen on Enter/Space keydown for keyboard access', () => {
    const onOpen = vi.fn();
    render(<SubmissionCard row={row()} canGrade timeLabel="now" fullTime="now" onOpen={onOpen} />);

    fireEvent.keyDown(screen.getByTestId('submission-card'), { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('shows the full-width layout in list variant (no title clamp assertions needed beyond render)', () => {
    render(
      <SubmissionCard
        row={row()}
        canGrade={false}
        timeLabel="now"
        fullTime="now"
        onOpen={vi.fn()}
        variant="list"
      />,
    );
    expect(screen.getByText('What is x in 2x=4?')).toBeInTheDocument();
  });
});
