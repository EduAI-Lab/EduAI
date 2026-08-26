import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityAnalyticsRow, StudentMetricRow } from '~/lib/types';

const { mockCourseAnalytics, mockCourseStudentMetrics } = vi.hoisted(() => ({
  mockCourseAnalytics: vi.fn(),
  mockCourseStudentMetrics: vi.fn(),
}));

vi.mock('~/lib/api', () => ({
  default: {
    courseAnalytics: mockCourseAnalytics,
    courseStudentMetrics: mockCourseStudentMetrics,
  },
}));

import { CourseAnalyticsPanel } from '~/components/courses/CourseAnalyticsPanel';

describe('CourseAnalyticsPanel', () => {
  beforeEach(() => {
    mockCourseAnalytics.mockReset();
    mockCourseStudentMetrics.mockReset();
  });

  it('shows a loading state, then renders stats once data resolves', async () => {
    mockCourseAnalytics.mockResolvedValue([]);
    mockCourseStudentMetrics.mockResolvedValue([]);

    render(<CourseAnalyticsPanel courseId={1} />);
    expect(screen.getByText('Loading analytics…')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('No analytics recorded yet.')).toBeInTheDocument();
    });
    expect(screen.getByText('No metrics recorded yet.')).toBeInTheDocument();
  });

  it('shows an error state when loading fails', async () => {
    mockCourseAnalytics.mockRejectedValue(new Error('boom'));
    mockCourseStudentMetrics.mockResolvedValue([]);

    render(<CourseAnalyticsPanel courseId={1} />);

    expect(await screen.findByText('Could not load analytics.')).toBeInTheDocument();
  });

  it('computes accuracy and average rating stats from the fetched rows', async () => {
    const analytics: ActivityAnalyticsRow[] = [
      {
        activityId: 1,
        averageRating: 4,
        feedbackCount: 2,
        difficultyLabel: 'Easy',
        difficultyScore: 'Easy',
        activity: { id: 1, title: 'Q1' },
      },
      {
        activityId: 2,
        averageRating: 2,
        feedbackCount: 1,
        difficultyLabel: 'Hard',
        difficultyScore: 'Hard',
        activity: { id: 2, title: 'Q2' },
      },
    ];
    const metrics: StudentMetricRow[] = [
      { userId: 'u1', submissionCount: 5, correctSubmissionCount: 3, incorrectSubmissionCount: 2, helpRequestCount: 1 },
      { userId: 'u2', submissionCount: 5, correctSubmissionCount: 4, incorrectSubmissionCount: 1, helpRequestCount: 0 },
    ];
    mockCourseAnalytics.mockResolvedValue(analytics);
    mockCourseStudentMetrics.mockResolvedValue(metrics);

    render(<CourseAnalyticsPanel courseId={1} />);

    await waitFor(() => {
      expect(screen.getByText('Q1')).toBeInTheDocument();
    });

    // Accuracy: (3+4) correct / (3+4+2+1) graded = 7/10 = 70%
    expect(screen.getAllByText('70%').length).toBeGreaterThanOrEqual(1);
    // Avg rating across activities: (4+2)/2 = 3.0
    expect(screen.getByText('3.0')).toBeInTheDocument();
    expect(screen.getAllByText('Easy').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Hard').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('u1')).toBeInTheDocument();
  });

  it('re-fetches when courseId changes', async () => {
    mockCourseAnalytics.mockResolvedValue([]);
    mockCourseStudentMetrics.mockResolvedValue([]);

    const { rerender } = render(<CourseAnalyticsPanel courseId={1} />);
    await waitFor(() => expect(mockCourseAnalytics).toHaveBeenCalledWith(1));

    rerender(<CourseAnalyticsPanel courseId={2} />);
    await waitFor(() => expect(mockCourseAnalytics).toHaveBeenCalledWith(2));
  });
});
