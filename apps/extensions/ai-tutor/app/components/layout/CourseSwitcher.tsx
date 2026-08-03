/**
 * AI Tutor's breadcrumb course switcher — a thin adapter over the shared
 * `@eduai/ui` CourseSwitcher (issue #764), so Core, QuestionMaker, and AI Tutor
 * share one switcher. Lands on the same role shell (`/student` or `/instructor`).
 *
 * #1208: the list is searched server-side. The shared component's `onQueryChange`
 * (added in #1143 for exactly this) keeps it presentational — it renders whatever
 * `courses` it is given and never filters — so a user with more courses than one
 * page can still reach any of them by typing, instead of silently seeing the
 * first 200.
 */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { CourseSwitcher as SharedCourseSwitcher, type CourseSwitcherOption } from '@eduai/ui';

import api from '~/lib/api';
import { useDebouncedValue } from '~/hooks/useDebouncedValue';
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
  const [query, setQuery] = React.useState('');
  const debouncedQuery = useDebouncedValue(query);

  // Monotonic request id. Debouncing narrows the out-of-order window but does not
  // close it: a slow response for "co" can still land after a fast one for "cosc"
  // and repopulate the dropdown with stale results. Only the newest request in
  // flight may write state.
  const latestRequest = React.useRef(0);

  React.useEffect(() => {
    const requestId = ++latestRequest.current;
    void (async () => {
      try {
        const page = await api.listCourses({ search: debouncedQuery.trim() || undefined });
        if (latestRequest.current !== requestId) return;
        setCourses(Array.isArray(page.data) ? page.data : []);
      } catch {
        // Non-fatal: a failed lookup must never break the breadcrumb. The
        // trigger keeps whatever it already had.
      }
    })();
  }, [debouncedQuery]);

  // Seed with the current course so the trigger label is right before the list
  // resolves. Once a search is active that seed would be a phantom result, so it
  // applies only to the unsearched list — and `currentLabel` below carries the
  // trigger label independently, so dropping the seed can't blank the breadcrumb
  // the moment the results stop including the course the user is on.
  const searching = query.trim().length > 0;
  const current = splitTitle(currentTitle);
  const options: CourseSwitcherOption[] =
    courses.length > 0
      ? courses.map((c) => ({ id: c.id, ...splitTitle(c.title ?? 'Untitled course') }))
      : searching
        ? []
        : [{ id: courseId, ...current }];

  return (
    <SharedCourseSwitcher
      courses={options}
      currentId={courseId}
      currentLabel={current.label}
      onSelect={(id) => navigate(`${basePath}/courses/${id}`)}
      onOpenCurrent={() => navigate(`${basePath}/courses/${courseId}`)}
      onViewAll={() => navigate(basePath)}
      onQueryChange={setQuery}
      emptyLabel="No courses match"
    />
  );
}
