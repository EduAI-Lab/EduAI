/**
 * Core's inline breadcrumb course switcher — a thin adapter over the shared
 * `@eduai/ui` CourseSwitcher (issue #764), so it looks and behaves exactly like
 * the QuestionMaker and AI Tutor switchers. Only rendered on the course-detail
 * page, so fetching the authorized course list on mount is a single request.
 */
import * as React from "react";
import { useNavigate } from "react-router";

import { CourseSwitcher as SharedCourseSwitcher, type CourseSwitcherOption } from "@eduai/ui";

/** One bounded page at the API's max `pageSize`, for course pickers (#1041). */
const COURSE_PICKER_QUERY = "page=1&pageSize=200";


type CoreCourse = { id: string; code: string; name: string };

export function CourseSwitcher({
  currentCourseId,
  currentCourseCode,
  currentCourseName,
}: {
  currentCourseId: string;
  currentCourseCode: string;
  currentCourseName: string;
}) {
  const navigate = useNavigate();
  const [courses, setCourses] = React.useState<CoreCourse[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // #1041: `/api/courses` requires paging. The switcher is a picker, not
        // a table, so it takes one bounded page at the API's maximum size.
        const res = await fetch(`/api/courses?${COURSE_PICKER_QUERY}`);
        if (!res.ok) return;
        const data = (await res.json()) as { data?: CoreCourse[] };
        if (!cancelled) setCourses(data.data ?? []);
      } catch {
        // Non-fatal: the switcher still shows the current course.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Seed with the current course's code (matching the resolved list's label) so
  // the trigger label doesn't flash name→code once the fetch resolves.
  const options: CourseSwitcherOption[] =
    courses.length > 0
      ? courses.map((c) => ({ id: c.id, label: c.code || c.name, sublabel: c.name }))
      : [{ id: currentCourseId, label: currentCourseCode || currentCourseName, sublabel: currentCourseName }];

  return (
    <SharedCourseSwitcher
      courses={options}
      currentId={currentCourseId}
      onSelect={(id) => navigate(`/courses/${id}`)}
      onOpenCurrent={() => navigate(`/courses/${currentCourseId}`)}
      onViewAll={() => navigate("/courses")}
    />
  );
}
