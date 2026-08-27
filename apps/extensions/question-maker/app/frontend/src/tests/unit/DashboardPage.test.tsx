/**
 * Unit tests for DashboardPage (#1544). All hooks and the presentational
 * QmDashboardView are mocked so we exercise the page's own stat/analytics
 * derivation and quick-action gating logic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const {
  useAuthMock,
  useDisplayCoursesMock,
  useQuestionStatsMock,
  useAllQuestionsMock,
  useAllAssessmentsMock,
  useAutoRedirectForMainTourMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useDisplayCoursesMock: vi.fn(),
  useQuestionStatsMock: vi.fn(),
  useAllQuestionsMock: vi.fn(),
  useAllAssessmentsMock: vi.fn(),
  useAutoRedirectForMainTourMock: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => useAuthMock() }));
vi.mock('@/hooks/useDisplayCourses', () => ({ useDisplayCourses: () => useDisplayCoursesMock() }));
vi.mock('@/hooks/useQuestionStats', () => ({ useQuestionStats: () => useQuestionStatsMock() }));
vi.mock('@/hooks/useAllQuestions', () => ({ useAllQuestions: () => useAllQuestionsMock() }));
vi.mock('@/hooks/useAllAssessments', () => ({ useAllAssessments: () => useAllAssessmentsMock() }));
vi.mock('@/tour/useAutoRedirectForMainTour', () => ({
  useAutoRedirectForMainTour: () => useAutoRedirectForMainTourMock(),
}));

let lastProps: any;
vi.mock('@/components/dashboard/QmDashboardView', () => ({
  QmDashboardView: (props: any) => {
    lastProps = props;
    return <div>dashboard-view</div>;
  },
}));

import DashboardPage from '@/pages/DashboardPage';

afterEach(cleanup);

function setup(overrides: {
  user?: any;
  courses?: any[];
  coursesLoading?: boolean;
  questions?: any[];
  questionsLoading?: boolean;
  assessments?: any[];
  assessmentsLoading?: boolean;
  stats?: any;
} = {}) {
  useAuthMock.mockReturnValue({ user: overrides.user ?? { name: 'Jane Doe', role: 'STUDENT' } });
  useDisplayCoursesMock.mockReturnValue({
    displayCourses: overrides.courses ?? [{ id: 1, code: 'COSC101', name: 'Intro' }],
    isLoading: overrides.coursesLoading ?? false,
  });
  useQuestionStatsMock.mockReturnValue({
    stats: 'stats' in overrides ? overrides.stats : { totalQuestions: 10 },
  });
  useAllQuestionsMock.mockReturnValue({
    questions: overrides.questions ?? [],
    isLoading: overrides.questionsLoading ?? false,
  });
  useAllAssessmentsMock.mockReturnValue({
    assessments: overrides.assessments ?? [],
    isLoading: overrides.assessmentsLoading ?? false,
  });
}

describe('DashboardPage', () => {
  it('derives greeting name from the first word of the user name', () => {
    setup({ user: { name: 'Jane Doe', role: 'STUDENT' } });
    render(<DashboardPage />);
    expect(lastProps.greetingName).toBe('Jane');
  });

  it('excludes Settings from quick actions for non-staff users', () => {
    setup({ user: { name: 'Jane', role: 'STUDENT' } });
    render(<DashboardPage />);
    expect(lastProps.quickActions.some((a: any) => a.label === 'Settings')).toBe(false);
  });

  it('includes Settings quick action for staff roles', () => {
    setup({ user: { name: 'Jane', role: 'ADMIN' } });
    render(<DashboardPage />);
    expect(lastProps.quickActions.some((a: any) => a.label === 'Settings')).toBe(true);
  });

  it('aggregates question type/difficulty/ai analytics from questions', () => {
    setup({
      questions: [
        {
          id: 1,
          type: 'MCQ',
          courseId: 1,
          description: 'Q1',
          updatedAt: '2024-01-01',
          variants: [
            { difficulty: 'easy', isAiGenerated: true, isDraft: false },
            { difficulty: 'hard', isAiGenerated: false, isDraft: true },
          ],
        },
      ],
    });
    render(<DashboardPage />);
    expect(lastProps.analytics.totalQuestions).toBe(1);
    expect(lastProps.analytics.totalVariants).toBe(2);
    expect(lastProps.analytics.aiCount).toBe(1);
    expect(lastProps.analytics.humanCount).toBe(1);
    expect(lastProps.analytics.reviewedCount).toBe(1);
    const easy = lastProps.analytics.difficulty.find((d: any) => d.label === 'Easy');
    const hard = lastProps.analytics.difficulty.find((d: any) => d.label === 'Hard');
    expect(easy.value).toBe(1);
    expect(hard.value).toBe(1);
  });

  it('falls back to computed question count when stats are unavailable', () => {
    setup({ stats: null, questions: [{ id: 1, type: 'SA', courseId: 1, updatedAt: '2024-01-01' }] });
    render(<DashboardPage />);
    const questionsStat = lastProps.stats.find((s: any) => s.label === 'Questions');
    expect(questionsStat.value).toBe(1);
  });

  it('sorts recent items by updatedAt descending and caps at 6', () => {
    const questions = Array.from({ length: 4 }).map((_, i) => ({
      id: i,
      type: 'MCQ',
      courseId: 1,
      description: `Q${i}`,
      updatedAt: `2024-01-0${i + 1}`,
    }));
    const assessments = Array.from({ length: 4 }).map((_, i) => ({
      id: i,
      name: `A${i}`,
      courseId: 1,
      updatedAt: `2024-02-0${i + 1}`,
    }));
    setup({ questions, assessments });
    render(<DashboardPage />);
    expect(lastProps.recentItems).toHaveLength(6);
    expect(lastProps.recentItems[0].id).toBe('assessment-3');
  });
});
