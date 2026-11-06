import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  courseThemeVars,
  defaultColorIndexForCourse,
  paletteColorAtIndex,
  termLabel,
  type CourseAccentColor,
} from "@eduai/ui";
import {
  IconBooks,
  IconSchool,
  IconChevronRight,
  IconClipboardList,
  IconDotsVertical,
  IconHelpCircle,
  IconLayoutGrid,
  IconList,
  type Icon,
} from "@tabler/icons-react";
import { Course } from "@/types/question";
import { getDepartmentLabel } from "@/lib/units";

// Mirrors apps/extensions/ai-tutor/app/components/dashboard/TeachingDashboard.tsx
export type QmCourseView = "card" | "list";
export type QmCourseLink = { key: string; label: string; icon: Icon; href: string };

const VIEW_KEY = "eduai.questionMaker.courseView";

// Mirrors apps/extensions/ai-tutor/app/components/dashboard/TeachingDashboard.tsx
export function useQmCourseView(): [QmCourseView, (view: QmCourseView) => void] {
  const [view, setView] = useState<QmCourseView>("card");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(VIEW_KEY) === "list") setView("list");
    } catch {
      // Storage can be blocked; the default view still works.
    }
  }, []);
  const update = (next: QmCourseView) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Not remembered, but the switch still applies.
    }
  };
  return [view, update];
}

const toggleItemClass = "data-[state=on]:bg-primary data-[state=on]:text-primary-foreground";

export function QmCourseViewToggle({
  view,
  onChange,
}: {
  view: QmCourseView;
  onChange: (v: QmCourseView) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      aria-label="Course layout"
      value={view}
      // Radix emits "" when the active item is clicked again; keep the current view.
      onValueChange={(v) => v && onChange(v === "list" ? "list" : "card")}
    >
      <ToggleGroupItem value="card" aria-label="Card view" className={toggleItemClass}>
        <IconLayoutGrid className="size-4" aria-hidden="true" />
      </ToggleGroupItem>
      <ToggleGroupItem value="list" aria-label="List view" className={toggleItemClass}>
        <IconList className="size-4" aria-hidden="true" />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

// Cross-platform identity: keyed off the Core course id so a course keeps its
// colour in Core, AI Tutor and QM; the local id is only a fallback.
export function qmCourseAccent(course: Course): CourseAccentColor {
  return paletteColorAtIndex(defaultColorIndexForCourse(course.coreCourseId ?? String(course.id)));
}

export function qmCourseLinks(course: Course, canvasLinked: boolean): QmCourseLink[] {
  const base = `/courses/${course.id}`;
  const links: QmCourseLink[] = [
    { key: "questions", label: "Questions", icon: IconHelpCircle, href: `${base}?tab=questions` },
    { key: "banks", label: "Banks", icon: IconBooks, href: `${base}?tab=banks` },
    {
      key: "assessments",
      label: "Assessments",
      icon: IconClipboardList,
      href: `${base}?tab=assessments`,
    },
  ];
  if (canvasLinked) {
    links.push({ key: "canvas", label: "Canvas", icon: IconSchool, href: `${base}?tab=canvas` });
  }
  return links;
}

export function QmCourseStatusPill({ isPublished }: { isPublished: boolean | null | undefined }) {
  if (isPublished === null || isPublished === undefined) return null;
  return (
    <Badge variant={isPublished ? "success" : "warning"}>
      {isPublished ? "Published" : "Unpublished"}
    </Badge>
  );
}

function courseTitle(course: Course): string {
  return course.code ? `${course.code} · ${course.name}` : course.name;
}

// Icon buttons named by a tooltip, as on AI Tutor's cards.
function QmCourseLinkButton({ link }: { link: QmCourseLink }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={link.href}
          className={cn(
            "relative z-10 inline-flex size-9 items-center justify-center rounded-md text-xs font-medium text-[color-mix(in_oklch,var(--course-accent)_72%,var(--foreground))] transition-colors hover:bg-[var(--course-muted)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <link.icon className="size-5" aria-hidden="true" />
          <span className="sr-only">{link.label}</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent>{link.label}</TooltipContent>
    </Tooltip>
  );
}

function CourseMenu({ course }: { course: Course }) {
  const base = `/courses/${course.id}`;
  const label = course.code || course.name;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${label} actions`}
          className="relative z-10 flex size-8 items-center justify-center rounded-md text-white/90 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <IconDotsVertical className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        <DropdownMenuItem asChild>
          <Link to={base}>Open course</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={`${base}?tab=questions`}>Questions</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={`${base}?tab=assessments`}>Assessments</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function QmCourseGridCard({
  course,
  links,
  showDepartment = false,
}: {
  course: Course;
  links: QmCourseLink[];
  showDepartment?: boolean;
}) {
  const code = course.code || course.name;
  return (
    <article
      // Every card is a tour target: the guided tour spotlights the first one
      // on screen and follows it into its workspace.
      data-tour="course-select"
      data-tour-route={`/courses/${course.id}`}
      data-course-id={course.id}
      style={courseThemeVars(qmCourseAccent(course))}
      className="group/card relative flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xs transition-shadow focus-within:shadow-md hover:shadow-md"
    >
      <div className="relative h-[78px] shrink-0" style={{ background: "var(--course-accent)" }}>
        {showDepartment && course.department && (
          <span className="absolute bottom-2 left-4 text-[10px] font-semibold uppercase tracking-wide text-white/80">
            {getDepartmentLabel(course.department)}
          </span>
        )}
        <div className="absolute right-2 top-2 z-10">
          <CourseMenu course={course} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 px-4 pt-3 pb-2">
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug">
          <Link
            to={`/courses/${course.id}`}
            className="text-[color-mix(in_oklch,var(--course-accent)_72%,var(--foreground))] after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
          >
            {courseTitle(course)}
          </Link>
        </h3>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{termLabel(course.term, course.year)}</span>
          <QmCourseStatusPill isPublished={course.isPublished} />
        </div>
      </div>
      {links.length > 0 && (
        <nav
          aria-label={`${code} sections`}
          className="flex items-center gap-1 border-t border-border px-2 py-1"
        >
          {links.map((link) => (
            <QmCourseLinkButton key={link.key} link={link} />
          ))}
        </nav>
      )}
    </article>
  );
}

// Name keeps a minmax floor: with all-fixed neighbours it collapsed to 0 width in a
// ~700px column. Department and Last updated only show from lg, where there is room.
const LIST_GRID =
  "grid grid-cols-[6rem_minmax(0,1fr)_auto] sm:grid-cols-[6rem_minmax(8rem,1fr)_5rem_6.5rem_1rem] lg:grid-cols-[6rem_minmax(8rem,2fr)_5rem_6.5rem_minmax(0,1fr)_3.5rem_1rem] items-center gap-2 px-3";

export function QmCourseListHeader() {
  return (
    <div
      aria-hidden="true"
      className={`${LIST_GRID} h-8 border-b bg-muted/50 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground`}
    >
      <span>Code</span>
      <span>Name</span>
      <span className="hidden sm:block">Term</span>
      <span>Status</span>
      <span className="hidden lg:block">Department</span>
      <span className="hidden lg:block">Last updated</span>
      <span className="hidden sm:block" />
    </div>
  );
}

export function QmCourseListRow({ course }: { course: Course }) {
  const updated = course.updatedAt ? new Date(course.updatedAt) : null;
  return (
    <div
      data-tour="course-select"
      data-tour-route={`/courses/${course.id}`}
      data-course-id={course.id}
      style={courseThemeVars(qmCourseAccent(course))}
      className={`${LIST_GRID} relative h-9 border-b text-sm last:border-b-0 hover:bg-muted/40`}
    >
      <span className="truncate font-bold text-[var(--course-accent)]">{course.code ?? "—"}</span>
      <Link
        to={`/courses/${course.id}`}
        title={course.name}
        className="truncate after:absolute after:inset-0"
      >
        {course.name}
      </Link>
      <span className="hidden truncate sm:block">{termLabel(course.term, course.year)}</span>
      <span>
        <QmCourseStatusPill isPublished={course.isPublished} />
      </span>
      <span className="hidden truncate lg:block">
        {course.department ? getDepartmentLabel(course.department) : "—"}
      </span>
      <span className="hidden lg:block">
        {updated && !Number.isNaN(updated.getTime())
          ? updated.toLocaleDateString(undefined, { month: "short", day: "numeric" })
          : "—"}
      </span>
      <IconChevronRight aria-hidden="true" className="hidden size-4 text-primary-text sm:block" />
    </div>
  );
}
