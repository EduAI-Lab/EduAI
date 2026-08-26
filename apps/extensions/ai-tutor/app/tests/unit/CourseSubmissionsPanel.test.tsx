import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmissionRow } from '~/lib/types';

const { mockCourseSubmissions, mockGradeSubmission } = vi.hoisted(() => ({
  mockCourseSubmissions: vi.fn(),
  mockGradeSubmission: vi.fn(),
}));

vi.mock('~/lib/api', () => ({
  default: {
    courseSubmissions: mockCourseSubmissions,
    gradeSubmission: mockGradeSubmission,
  },
}));

let mockPerms: { user: { role: string } | null; access: string | null } = {
  user: { role: 'INSTRUCTOR' },
  access: 'instructor',
};
vi.mock('~/hooks/useAtPermissions', () => ({
  useAtPermissions: () => mockPerms,
}));

vi.mock('@eduai/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@eduai/ui')>();
  return {
    ...actual,
    Dialog: ({ open, children }: any) => (open ? <div role="dialog">{children}</div> : null),
    DialogContent: ({ children }: any) => <div>{children}</div>,
    DialogHeader: ({ children }: any) => <div>{children}</div>,
    DialogTitle: ({ children }: any) => <h2>{children}</h2>,
    DialogDescription: ({ children }: any) => <p>{children}</p>,
    DialogFooter: ({ children }: any) => <div>{children}</div>,
  };
});

import { CourseSubmissionsPanel } from '~/components/courses/CourseSubmissionsPanel';

function submission(overrides: Partial<SubmissionRow> = {}): SubmissionRow {
  return {
    id: 1,
    userId: 'u1',
    studentName: 'Ada Lovelace',
    activityId: 10,
    activityTitle: 'Solve for x',
    lessonTitle: 'Week 1',
    questionText: 'What is x?',
    attemptNumber: 1,
    response: { answerOption: 0 },
    answerLabel: 'x = 2',
    aiFeedback: null,
    score: null,
    isCorrect: null,
    createdAt: '2026-03-10T08:00:00.000Z',
    ...overrides,
  };
}

describe('CourseSubmissionsPanel', () => {
  beforeEach(() => {
    mockCourseSubmissions.mockReset();
    mockGradeSubmission.mockReset();
    mockPerms = { user: { role: 'INSTRUCTOR' }, access: 'instructor' };
  });

  afterEach(() => {
    cleanup();
  });

  it('shows a loading state, then renders stats and rows', async () => {
    mockCourseSubmissions.mockResolvedValue([
      submission(),
      submission({ id: 2, studentName: 'Grace Hopper', isCorrect: true }),
    ]);
    render(<CourseSubmissionsPanel courseId={1} />);
    expect(screen.getByText('Loading submissions…')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    });
  });

  it('shows an empty state when there are no submissions', async () => {
    mockCourseSubmissions.mockResolvedValue([]);
    render(<CourseSubmissionsPanel courseId={1} />);
    expect(await screen.findByText('No submissions yet.')).toBeInTheDocument();
  });

  it('shows an error state when loading fails', async () => {
    mockCourseSubmissions.mockRejectedValue(new Error('boom'));
    render(<CourseSubmissionsPanel courseId={1} />);
    expect(await screen.findByText('Could not load submissions.')).toBeInTheDocument();
  });

  it('filters by status', async () => {
    mockCourseSubmissions.mockResolvedValue([
      submission({ id: 1, isCorrect: true, studentName: 'Correct Kid' }),
      submission({ id: 2, isCorrect: false, studentName: 'Incorrect Kid' }),
      submission({ id: 3, isCorrect: null, studentName: 'Ungraded Kid' }),
    ]);
    render(<CourseSubmissionsPanel courseId={1} />);
    await waitFor(() => expect(screen.getByText('Correct Kid')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('radio', { name: 'Needs grading' }));
    expect(screen.getByText('Ungraded Kid')).toBeInTheDocument();
    expect(screen.queryByText('Correct Kid')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Correct' }));
    expect(screen.getByText('Correct Kid')).toBeInTheDocument();
    expect(screen.queryByText('Ungraded Kid')).not.toBeInTheDocument();
  });

  it('filters by search text', async () => {
    mockCourseSubmissions.mockResolvedValue([
      submission({ id: 1, studentName: 'Ada Lovelace' }),
      submission({ id: 2, studentName: 'Grace Hopper' }),
    ]);
    render(<CourseSubmissionsPanel courseId={1} />);
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Search student or activity…'), {
      target: { value: 'grace' },
    });
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
  });

  it('shows "no submissions match this filter" when a filter clears the list', async () => {
    mockCourseSubmissions.mockResolvedValue([submission({ studentName: 'Ada Lovelace' })]);
    render(<CourseSubmissionsPanel courseId={1} />);
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Search student or activity…'), {
      target: { value: 'nonexistent' },
    });
    expect(screen.getByText('No submissions match this filter.')).toBeInTheDocument();
  });

  it('opens the grade dialog and saves a grade optimistically', async () => {
    mockCourseSubmissions.mockResolvedValue([submission()]);
    mockGradeSubmission.mockResolvedValue({ isCorrect: true, score: 10 });
    render(<CourseSubmissionsPanel courseId={1} />);
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Grade' }));
    expect(await screen.findByText('Override grade')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save grade' }));

    await waitFor(() => {
      expect(mockGradeSubmission).toHaveBeenCalledWith(10, 1, { isCorrect: null, score: null });
    });
  });

  it('rolls back the optimistic update and shows an error when saving fails', async () => {
    mockCourseSubmissions.mockResolvedValue([submission()]);
    mockGradeSubmission.mockRejectedValue(new Error('boom'));
    render(<CourseSubmissionsPanel courseId={1} />);
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Grade' }));
    });
    expect(await screen.findByText('Override grade')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save grade' }));
    });

    await waitFor(() => {
      expect(screen.getByText('Could not save the grade. Try again.')).toBeInTheDocument();
    });
  });

  it('hides the grade override section and shows Close for read-only viewers', async () => {
    mockPerms = { user: { role: 'STUDENT' }, access: 'student' };
    mockCourseSubmissions.mockResolvedValue([submission()]);
    render(<CourseSubmissionsPanel courseId={1} />);
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'View' }));
    });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('Submitted answer')).toBeInTheDocument();
    expect(within(dialog).queryByText('Override grade')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('toggles between grid and list views', async () => {
    mockCourseSubmissions.mockResolvedValue([submission()]);
    render(<CourseSubmissionsPanel courseId={1} />);
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Extended view' }));
    expect(screen.getByRole('button', { name: 'Extended view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
