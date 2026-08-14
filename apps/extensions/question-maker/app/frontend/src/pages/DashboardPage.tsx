/**
 * QM dashboard container. Wires auth, courses, question/assessment data and
 * derives stats, analytics, and recent activity, then renders the presentational view.
 */
import { useMemo } from 'react';
import {
  IconBooks,
  IconLibrary,
  IconHelpCircle,
  IconSettings,
} from '@tabler/icons-react';
import { useAuth } from '@/contexts/AuthContext';
import { useDisplayCourses } from '@/hooks/useDisplayCourses';
import { useQuestionStats } from '@/hooks/useQuestionStats';
import { useAllQuestions } from '@/hooks/useAllQuestions';
import { useAllAssessments } from '@/hooks/useAllAssessments';
import { questionTypeLabels } from '@/types/question';
import {
  QmDashboardView,
  type QmDashboardCourse,
  type QmDashboardRecentItem,
  type QmDashboardStat,
  type QmDashboardQuickAction,
  type QmDashboardAnalytics,
} from '@/components/dashboard/QmDashboardView';
import { useAutoRedirectForMainTour } from '@/tour/useAutoRedirectForMainTour';

const STAFF_ROLES = new Set(['ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR']);

const TYPE_COLORS: Record<string, string> = {
  MCQ: 'var(--color-series-3)',
  SA: 'var(--color-series-7)',
  LA: 'var(--color-series-8)',
};
// Pull from the shared difficulty tokens (index.css) so meters match every other
// difficulty surface and adapt to light/dark automatically.
const DIFF_COLORS = {
  easy: 'var(--diff-easy-solid)',
  medium: 'var(--diff-medium-solid)',
  hard: 'var(--diff-hard-solid)',
};

export default function DashboardPage() {
  useAutoRedirectForMainTour();
  const { user } = useAuth();
  const { displayCourses, isLoading: coursesLoading } = useDisplayCourses();
  const { stats: questionStats } = useQuestionStats();
  const { questions, isLoading: questionsLoading } = useAllQuestions();
  const { assessments, isLoading: assessmentsLoading } = useAllAssessments();

  const firstName = user?.name?.trim().split(/\s+/)[0];
  const isStaff = user ? STAFF_ROLES.has(user.role) : false;

  const courses = useMemo<QmDashboardCourse[]>(
    () =>
      displayCourses.map((c) => ({
        id: c.id,
        code: c.code ?? '—',
        name: c.name,
      })),
    [displayCourses],
  );

  const analytics = useMemo<QmDashboardAnalytics>(() => {
    const typeCounts: Record<string, number> = { MCQ: 0, SA: 0, LA: 0 };
    let easy = 0;
    let medium = 0;
    let hard = 0;
    let ai = 0;
    let human = 0;
    let reviewed = 0;
    let totalVariants = 0;

    for (const q of questions) {
      typeCounts[q.type] = (typeCounts[q.type] ?? 0) + 1;
      for (const v of q.variants ?? []) {
        totalVariants += 1;
        const d = String(v.difficulty ?? 'medium').toLowerCase();
        if (d === 'easy') easy += 1;
        else if (d === 'hard') hard += 1;
        else medium += 1;
        if (v.isAiGenerated) ai += 1;
        else human += 1;
        if (!v.isDraft) reviewed += 1;
      }
    }

    const typeComposition = (['MCQ', 'SA', 'LA'] as const)
      .map((t) => ({ label: questionTypeLabels[t], value: typeCounts[t] ?? 0, color: TYPE_COLORS[t] }))
      .filter((s) => s.value > 0);

    return {
      typeComposition,
      difficulty: [
        { label: 'Easy', value: easy, color: DIFF_COLORS.easy },
        { label: 'Medium', value: medium, color: DIFF_COLORS.medium },
        { label: 'Hard', value: hard, color: DIFF_COLORS.hard },
      ],
      totalQuestions: questions.length,
      totalVariants,
      aiCount: ai,
      humanCount: human,
      reviewedCount: reviewed,
    };
  }, [questions]);

  const questionCount = questionStats?.totalQuestions ?? questions.length;

  const stats = useMemo<QmDashboardStat[]>(
    () => [
      { label: 'Courses', value: displayCourses.length },
      { label: 'Questions', value: questionCount },
      { label: 'Assessments', value: assessments.length },
      { label: 'AI-generated', value: analytics.aiCount },
    ],
    [displayCourses.length, questionCount, assessments.length, analytics.aiCount],
  );

  const recentItems = useMemo<QmDashboardRecentItem[]>(() => {
    const questionItems: QmDashboardRecentItem[] = questions.map((q) => ({
      id: `question-${q.id}`,
      label: q.description?.trim() || `${questionTypeLabels[q.type]} question`,
      sublabel: 'Question',
      href: `/courses/${q.courseId}?tab=questions`,
      updatedAt: q.updatedAt,
    }));

    const assessmentItems: QmDashboardRecentItem[] = assessments.map((a) => ({
      id: `assessment-${a.id}`,
      label: a.name,
      sublabel: 'Assessment',
      href: a.courseId != null ? `/courses/${a.courseId}/assessments/${a.id}` : `/courses`,
      updatedAt: a.updatedAt,
    }));

    return [...questionItems, ...assessmentItems]
      .sort((x, y) => new Date(y.updatedAt).getTime() - new Date(x.updatedAt).getTime())
      .slice(0, 6);
  }, [questions, assessments]);

  const quickActions = useMemo<QmDashboardQuickAction[]>(() => {
    const actions: QmDashboardQuickAction[] = [
      {
        label: 'Browse courses',
        description: 'Open any of your courses',
        href: '/courses',
        icon: <IconBooks size={16} stroke={1.75} />,
      },
      {
        label: 'Question Library',
        description: 'Search questions across courses',
        href: '/library',
        icon: <IconLibrary size={16} stroke={1.75} />,
      },
      {
        label: 'Help & shortcuts',
        description: 'Tips, tours, and keyboard shortcuts',
        href: '/help',
        icon: <IconHelpCircle size={16} stroke={1.75} />,
      },
    ];

    if (isStaff) {
      actions.push({
        label: 'Settings',
        description: 'Configure your workspace',
        href: '/settings',
        icon: <IconSettings size={16} stroke={1.75} />,
      });
    }

    return actions;
  }, [isStaff]);

  return (
    <QmDashboardView
      greetingName={firstName}
      stats={stats}
      courses={courses}
      coursesLoading={coursesLoading}
      recentItems={recentItems}
      recentLoading={questionsLoading || assessmentsLoading}
      quickActions={quickActions}
      analytics={analytics}
    />
  );
}
