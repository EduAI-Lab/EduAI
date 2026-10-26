import { termLabel, type CourseNavConfig } from "@eduai/ui";

import { resolveCourseTab, type ActiveTab } from "@/pages/course-detail/courseTabs";
import type { Course } from "@/types/question";

const SECTIONS = [
  { key: "overview", label: "Overview" },
  { key: "questions", label: "Questions" },
  { key: "banks", label: "Banks" },
  { key: "assessments", label: "Assessments", tourId: "assessment-tab" },
  { key: "canvas", label: "Canvas" },
] satisfies { key: ActiveTab; label: string; tourId?: string }[];

/** The page below a course section, and the section it belongs to. */
type SubPage = { section: ActiveTab; label: string };

function resolveSubPage(pathname: string): SubPage | null {
  if (pathname.endsWith("/questions/new")) return { section: "questions", label: "New question" };
  if (/\/questions\/[^/]+\/edit$/.test(pathname))
    return { section: "questions", label: "Edit question" };
  if (/\/questions\/[^/]+\/variant$/.test(pathname))
    return { section: "questions", label: "New variant" };
  if (/\/assessments\/[^/]+\/variants$/.test(pathname))
    return { section: "assessments", label: "Variants" };
  if (/\/assessments\/[^/]+$/.test(pathname))
    return { section: "assessments", label: "Assessment builder" };
  if (/\/banks\/[^/]+$/.test(pathname)) return { section: "banks", label: "Question bank" };
  return null;
}

/** The QM course id in a `/courses/:id…` path, or null off the course workspace. */
export function courseIdFromPath(pathname: string): number | null {
  const match = pathname.match(/^\/courses\/(\d+)/);
  return match ? Number(match[1]) : null;
}

/**
 * The course menu for any page of a course workspace: the sections the old
 * tab bar had, as `?tab=` links. Deep pages (composer, builder, a bank) keep
 * the menu with their parent section active and add their own crumb.
 *
 * `canvasLinked` is what the course page last learned about the Canvas link:
 * `null` while it resolves (the section stays, as the tab did), `undefined`
 * when this course's page has not reported yet (hidden until it does).
 */
export function buildQmCourseNav({
  pathname,
  search,
  course,
  canvasLinked,
}: {
  pathname: string;
  search: string;
  course: Course | undefined;
  canvasLinked: boolean | null | undefined;
}): CourseNavConfig | undefined {
  const courseId = courseIdFromPath(pathname);
  if (courseId == null || !course || course.id !== courseId) return undefined;

  const href = `/courses/${courseId}`;
  const subPage = resolveSubPage(pathname);
  const showCanvas = canvasLinked !== undefined && canvasLinked !== false;
  const activeKey =
    subPage?.section ??
    resolveCourseTab(new URLSearchParams(search).get("tab"), canvasLinked ?? null);

  return {
    href,
    code: course.code ?? course.name,
    term: termLabel(course.term, course.year),
    activeKey,
    subPage: subPage?.label,
    items: SECTIONS.filter((section) => section.key !== "canvas" || showCanvas).map((section) => ({
      ...section,
      href: `${href}?tab=${section.key}`,
    })),
  };
}
