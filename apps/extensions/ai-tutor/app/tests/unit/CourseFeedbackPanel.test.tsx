import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CourseFeedbackPanel } from '~/components/courses/CourseFeedbackPanel';
import type { ActivityFeedbackRow } from '~/lib/types';

const { mockListCourseFeedback } = vi.hoisted(() => ({
  mockListCourseFeedback: vi.fn(),
}));

vi.mock('~/lib/api', () => ({
  default: {
    listCourseFeedback: mockListCourseFeedback,
  },
}));

const sampleRow: ActivityFeedbackRow = {
  id: 1,
  userId: 'student-1',
  activityId: 42,
  rating: 4,
  note: 'Helpful hints',
  createdAt: '2026-07-01T12:00:00.000Z',
};

describe('CourseFeedbackPanel', () => {
  beforeEach(() => {
    mockListCourseFeedback.mockReset();
    mockListCourseFeedback.mockResolvedValue([sampleRow]);
  });

  it('renders feedback rows after loading', async () => {
    render(<CourseFeedbackPanel courseId={7} />);

    expect(await screen.findByText('Helpful hints')).toBeInTheDocument();
    expect(screen.getByText('student-1')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(mockListCourseFeedback).toHaveBeenCalledWith(7, {
      activityId: undefined,
      studentId: undefined,
      take: 50,
      skip: 0,
    });
  });

  it('applies activity and student filters', async () => {
    render(<CourseFeedbackPanel courseId={7} />);
    await screen.findByText('Helpful hints');

    fireEvent.change(screen.getByLabelText('Activity ID'), { target: { value: '99' } });
    fireEvent.change(screen.getByLabelText('Student ID'), { target: { value: 'student-9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(mockListCourseFeedback).toHaveBeenLastCalledWith(7, {
        activityId: 99,
        studentId: 'student-9',
        take: 50,
        skip: 0,
      });
    });
  });

  it('paginates with take/skip', async () => {
    mockListCourseFeedback.mockResolvedValue(
      Array.from({ length: 50 }, (_, index) => ({
        ...sampleRow,
        id: index + 1,
      })),
    );

    render(<CourseFeedbackPanel courseId={7} />);
    await screen.findByTestId('course-feedback-panel');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(mockListCourseFeedback).toHaveBeenLastCalledWith(7, {
        activityId: undefined,
        studentId: undefined,
        take: 50,
        skip: 50,
      });
    });
  });

  it('shows an error when loading fails', async () => {
    mockListCourseFeedback.mockRejectedValue(new Error('boom'));

    render(<CourseFeedbackPanel courseId={7} />);

    expect(await screen.findByText('Could not load feedback.')).toBeInTheDocument();
  });
});
