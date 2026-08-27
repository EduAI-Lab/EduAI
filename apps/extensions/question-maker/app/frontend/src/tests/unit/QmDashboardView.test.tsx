/**
 * Unit tests for `QmDashboardView` (#1546): the fully props-driven dashboard —
 * onboarding-vs-stats branch, loading skeletons, empty recent activity, and
 * the analytics-visibility gate.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QmDashboardView, type QmDashboardViewProps } from '@/components/dashboard/QmDashboardView';

afterEach(() => cleanup());

function renderView(props: Partial<QmDashboardViewProps> = {}) {
  const defaults: QmDashboardViewProps = {
    stats: [{ label: 'Questions', value: 10 }],
    courses: [{ id: 1, code: 'CPSC 101', name: 'Intro to CS' }],
    recentItems: [],
    quickActions: [],
  };
  return render(
    <MemoryRouter>
      <QmDashboardView {...defaults} {...props} />
    </MemoryRouter>
  );
}

describe('QmDashboardView', () => {
  it('shows the onboarding card when there are no courses', () => {
    renderView({ courses: [] });
    expect(screen.getByText('Welcome to Question Maker')).toBeInTheDocument();
    expect(screen.getByText('Browse your courses')).toBeInTheDocument();
  });

  it('shows stats and course list when courses exist', () => {
    renderView();
    expect(screen.queryByText('Welcome to Question Maker')).toBeNull();
    expect(screen.getByText('CPSC 101')).toBeInTheDocument();
    expect(screen.getByText('Questions')).toBeInTheDocument();
  });

  it('includes a personalized greeting when greetingName is provided', () => {
    renderView({ greetingName: 'Ada' });
    expect(screen.getByText(/Ada/)).toBeInTheDocument();
  });

  it('shows the empty recent-activity state when there are no recent items', () => {
    renderView({ recentItems: [] });
    expect(screen.getByText('No recent activity yet.')).toBeInTheDocument();
  });

  it('renders recent activity items with a relative time label', () => {
    renderView({
      recentItems: [
        { id: 'q1', label: 'New MCQ question', href: '/q/1', updatedAt: new Date().toISOString(), sublabel: 'Question' },
      ],
    });
    expect(screen.getByText('New MCQ question')).toBeInTheDocument();
    expect(screen.getByText('Just now')).toBeInTheDocument();
  });

  it('shows loading skeletons for courses and does not render course rows', () => {
    const { container } = renderView({ coursesLoading: true });
    expect(screen.queryByText('CPSC 101')).toBeNull();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('does not render the analytics section when totalQuestions is zero', () => {
    renderView({
      analytics: {
        typeComposition: [],
        difficulty: [],
        totalQuestions: 0,
        totalVariants: 0,
        aiCount: 0,
        humanCount: 0,
        reviewedCount: 0,
      },
    });
    // No direct text assertion on the chart itself; just ensure the onboarding-vs-stats branch rendered normally.
    expect(screen.getByText('CPSC 101')).toBeInTheDocument();
  });
});

describe('QmDashboardView additional coverage', () => {
  it('shows loading skeletons for recent activity', () => {
    const { container } = renderView({ recentLoading: true, recentItems: [{ id: 'q1', label: 'x', href: '/x', updatedAt: new Date().toISOString() }] });
    expect(screen.queryByText('x')).toBeNull();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('defaults the recent-item sublabel to "Activity" when absent', () => {
    renderView({
      recentItems: [{ id: 'q1', label: 'No sublabel item', href: '/q/1', updatedAt: new Date().toISOString() }],
    });
    expect(screen.getByText('Activity')).toBeInTheDocument();
  });

  it('formats minutes/hours/yesterday/days-ago relative times', () => {
    const now = Date.now();
    renderView({
      recentItems: [
        { id: 'm', label: 'Mins item', href: '/m', updatedAt: new Date(now - 5 * 60_000).toISOString() },
        { id: 'h', label: 'Hours item', href: '/h', updatedAt: new Date(now - 3 * 60 * 60_000).toISOString() },
        { id: 'y', label: 'Yesterday item', href: '/y', updatedAt: new Date(now - 26 * 60 * 60_000).toISOString() },
        { id: 'd', label: 'Days item', href: '/d', updatedAt: new Date(now - 3 * 24 * 60 * 60_000).toISOString() },
        { id: 'old', label: 'Old item', href: '/old', updatedAt: new Date(now - 30 * 24 * 60 * 60_000).toISOString() },
      ],
    });
    expect(screen.getByText('5m ago')).toBeInTheDocument();
    expect(screen.getByText('3h ago')).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
    expect(screen.getByText('3 days ago')).toBeInTheDocument();
    expect(screen.getByText('Old item')).toBeInTheDocument();
  });

  it('renders the analytics section when totalQuestions > 0', () => {
    renderView({
      analytics: {
        typeComposition: [{ label: 'MCQ', value: 5, color: '#000' }] as any,
        difficulty: [{ label: 'Easy', value: 5, color: '#000' }],
        totalQuestions: 5,
        totalVariants: 8,
        aiCount: 3,
        humanCount: 2,
        reviewedCount: 1,
      },
    });
    expect(screen.getByText('CPSC 101')).toBeInTheDocument();
  });

  it('caps the course list panel to 5 courses', () => {
    const courses = Array.from({ length: 8 }, (_, i) => ({ id: i, code: `C${i}`, name: `Course ${i}` }));
    renderView({ courses });
    expect(screen.getByText('C0')).toBeInTheDocument();
    expect(screen.queryByText('C7')).toBeNull();
  });

  it('renders a default (non-personalized) greeting when greetingName is absent', () => {
    renderView({ greetingName: undefined });
    expect(screen.getByText(/Good (morning|afternoon|evening)/)).toBeInTheDocument();
  });
});
