/**
 * Core's inline breadcrumb course switcher — a thin adapter over the shared
 * `@eduai/ui` CourseSwitcher (issue #764), so it looks and behaves exactly like
 * the QuestionMaker and AI Tutor switchers. Only rendered on the course-detail
 * page, so fetching the authorized course list on mount is a single request.
 */
import * as React from "react";
import { useNavigate } from "react-router";

import { CourseSwitcher as SharedCourseSwitcher, type CourseSwitcherOption } from "@eduai/ui";

type CoreCourse = { id: string; code: string; name: string };

export function CourseSwitcher({
  currentCourseId,
  currentCourseName,
}: {
  currentCourseId: string;
  currentCourseName: string;
}) {
  const navigate = useNavigate();
  const [courses, setCourses] = React.useState<CoreCourse[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/courses");
        if (!res.ok) return;
        const data = (await res.json()) as { courses?: CoreCourse[] };
        if (!cancelled) setCourses(data.courses ?? []);
      } catch {
        // Non-fatal: the switcher still shows the current course.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Seed with the current course so the trigger label is correct before the
  // list resolves; the fetched list replaces it once available.
  const options: CourseSwitcherOption[] =
    courses.length > 0
      ? courses.map((c) => ({ id: c.id, label: c.code || c.name, sublabel: c.name }))
      : [{ id: currentCourseId, label: currentCourseName }];

  return (
    <SharedCourseSwitcher
      courses={options}
      currentId={currentCourseId}
      onSelect={(id) => navigate(`/courses/${id}`)}
      onViewAll={() => navigate("/courses")}
    />
  );
}
