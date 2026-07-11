/**
 * AI Tutor's breadcrumb course switcher — a thin adapter over the shared
 * `@eduai/ui` CourseSwitcher (issue #764), so Core, QuestionMaker, and AI Tutor
 * share one switcher. Lands on the same role shell (`/student` or `/instructor`).
 */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { CourseSwitcher as SharedCourseSwitcher, type CourseSwitcherOption } from '@eduai/ui';

import api from '~/lib/api';
import { splitTitle } from '~/lib/course-title';
import type { Course } from '~/lib/types';

export function CourseSwitcher({
  courseId,
  basePath,
  currentTitle,
}: {
  courseId: number;
  /** Role shell prefix, e.g. "/student" or "/instructor". */
  basePath: string;
  currentTitle: string;
}) {
  const navigate = useNavigate();
  const [courses, setCourses] = React.useState<Course[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = (await api.listCourses()) as Course[];
        if (!cancelled) setCourses(Array.isArray(list) ? list : []);
      } catch {
        // Non-fatal: the switcher still shows the current course.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Seed with the current course so the trigger label is right before the list
  // resolves; the fetched list replaces it once available.
  const options: CourseSwitcherOption[] =
    courses.length > 0
      ? courses.map((c) => ({ id: c.id, ...splitTitle(c.title) }))
      : [{ id: courseId, ...splitTitle(currentTitle) }];

  return (
    <SharedCourseSwitcher
      courses={options}
      currentId={courseId}
      onSelect={(id) => navigate(`${basePath}/courses/${id}`)}
      onOpenCurrent={() => navigate(`${basePath}/courses/${courseId}`)}
      onViewAll={() => navigate(basePath)}
    />
  );
}
