/**
 * QuestionMaker's breadcrumb course switcher — a thin adapter over the shared
 * `@eduai/ui` CourseSwitcher (issue #764), so Core, QuestionMaker, and AI Tutor
 * share one switcher. Carries the active workspace tab across the switch.
 */
import { useNavigate, useSearchParams } from 'react-router';
import { CourseSwitcher as SharedCourseSwitcher, type CourseSwitcherOption } from '@eduai/ui';
import { useDisplayCourses } from '@/hooks/useDisplayCourses';

const TAB_SAFE = new Set(['overview', 'questions', 'assessments', 'topics', 'canvas']);

interface CourseSwitcherProps {
  courseId: number;
}

export function CourseSwitcher({ courseId }: CourseSwitcherProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { displayCourses } = useDisplayCourses();

  // Carry the active tab across the switch when it's a real workspace tab.
  const tabParam = searchParams.get('tab');
  const targetTab = tabParam && TAB_SAFE.has(tabParam) ? tabParam : 'overview';

  const options: CourseSwitcherOption[] = displayCourses.map((c) => ({
    id: c.id,
    label: c.code || c.name,
    sublabel: c.code ? c.name : undefined,
  }));

  // Seed the current course when the loaded list doesn't contain it (still
  // loading, or filtered out) so the active course never drops out of the
  // dropdown — mirrors the AI-Tutor switcher's seed for real parity.
  if (!options.some((o) => o.id === courseId)) {
    options.unshift({ id: courseId, label: `Course ${courseId}` });
  }

  return (
    <SharedCourseSwitcher
      courses={options}
      currentId={courseId}
      onSelect={(id) => navigate(`/courses/${id}?tab=${targetTab}`)}
      onOpenCurrent={() => navigate(`/courses/${courseId}?tab=overview`)}
      onViewAll={() => navigate('/courses')}
    />
  );
}
