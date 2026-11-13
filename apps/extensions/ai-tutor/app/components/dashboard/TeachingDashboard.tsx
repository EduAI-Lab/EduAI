/**
 * @file The staff dashboard (INSTRUCTOR, UNIT_ADMIN, TA): a Canvas-style course
 * grid first, each card carrying its course's sections, with drafts and the
 * stats in a slim side column. Matches Core's `CourseDashboard` (#2105). ADMIN
 * and STUDENT keep `DashboardView`.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  IconChartBar,
  IconChevronRight,
  IconDotsVertical,
  IconExternalLink,
  IconEye,
  IconInbox,
  IconLayoutGrid,
  IconLayoutList,
  IconList,
  IconMessageCircle,
  IconPlayerPlay,
  IconWorldOff,
  IconWorldUpload,
  type Icon,
} from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  StatusBadge,
  ToggleGroup,
  ToggleGroupItem,
  CourseTile,
  CourseTileLinkButton,
  cn,
  courseThemeVars,
  termLabel,
  type CourseTileLink,
} from "@eduai/ui";
import type { Course } from "~/lib/types";
import { useLocalUser } from "~/hooks/useLocalUser";
import { useAtPermissions } from "~/hooks/useAtPermissions";
import { getCourseDetailTabs } from "~/lib/rbac/nav";
import { getEduAiAppUrl } from "~/lib/extension-urls";
import {
  accentForCourse,
  courseCode,
  courseName,
  courseTerm,
  courseYear,
} from "~/lib/course-display";
import { TruncatedListNotice } from "~/components/common/TruncatedListNotice";
import type { DashboardStatDef } from "./DashboardView";
import { useCoursePublishToggle } from "~/components/courses/useCoursePublishToggle";

type CourseView = "card" | "list";
export type TeachingCourseKind = "teaching" | "assisting" | "unit" | "taking";

const VIEW_STORAGE_KEY = "eduai.aiTutor.dashboard.courseView";

const SECTION_TITLES = {
  teaching: "Courses you teach",
  assisting: "Courses you assist",
  unit: "Unit courses",
  taking: "Courses you're taking",
} satisfies Record<TeachingCourseKind, string>;

/** Card is the default; the viewer's last choice is a per-browser convenience. */
function useCourseView(): [CourseView, (view: CourseView) => void] {
  const [view, setView] = useState<CourseView>("card");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(VIEW_STORAGE_KEY) === "list") setView("list");
    } catch {
      // Storage can be blocked; the default view still works.
    }
  }, []);
  const update = (next: CourseView) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Not remembered, but the switch still applies.
    }
  };
  return [view, update];
}

type CourseLink = CourseTileLink & { href: string };

const SECTION_ICONS = {
  content: IconLayoutList,
  submissions: IconInbox,
  feedback: IconMessageCircle,
  analytics: IconChartBar,
} satisfies Record<string, Icon>;

/** The section shortcuts a staff course card offers, gated per course like the course menu. */
export function useStaffCourseLinks() {
  const { user } = useLocalUser();
  const perms = useAtPermissions();
  return (course: Course, kind: TeachingCourseKind): CourseLink[] => {
    if (kind === "taking") {
      return [
        { key: "open", label: "Continue", icon: IconPlayerPlay, href: courseHref(course, kind) },
      ];
    }
    const base = `/instructor/courses/${course.id}`;
    // #1644: gate on the viewer's role on this course when the list carries it.
    const tabs = getCourseDetailTabs(
      user ? { id: user.id, role: user.role, authorizedUnits: user.authorizedUnits } : null,
      course.viewerRole ?? null,
    );
    const links: CourseLink[] = tabs.map((tab) => ({
      key: tab.id,
      label: tab.label,
      icon: SECTION_ICONS[tab.id],
      href: tab.id === "content" ? base : `${base}?tab=${tab.id}`,
    }));
    if (perms.canPreviewAsStudent) {
      links.push({
        key: "preview",
        label: "Preview as student",
        icon: IconEye,
        href: `/student/courses/${course.id}`,
      });
    }
    return links;
  };
}

function courseHref(course: Course, kind: TeachingCourseKind) {
  return kind === "taking" ? `/student/courses/${course.id}` : `/instructor/courses/${course.id}`;
}

function CourseLinkButton({ link, iconOnly }: { link: CourseLink; iconOnly?: boolean }) {
  return <CourseTileLinkButton link={link} iconOnly={iconOnly} LinkComponent={Link} />;
}

function CourseMenu({
  course,
  canPublish,
  onBanner,
  onTogglePublish,
}: {
  course: Course;
  canPublish: boolean;
  onBanner: boolean;
  onTogglePublish: (course: Course) => void;
}) {
  const coreHref = course.coreOfferingId
    ? `${getEduAiAppUrl()}/courses/${encodeURIComponent(course.coreOfferingId)}`
    : null;
  if (!canPublish && !coreHref) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${courseCode(course)} actions`}
          className={cn(
            "relative z-10 flex size-8 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2",
            onBanner
              ? "text-white/90 hover:bg-white/20 focus-visible:ring-white"
              : "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring",
          )}
        >
          <IconDotsVertical className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        {canPublish && (
          <DropdownMenuItem className="gap-2" onSelect={() => onTogglePublish(course)}>
            {course.isPublished ? (
              <IconWorldOff className="size-4 text-muted-foreground" aria-hidden="true" />
            ) : (
              <IconWorldUpload className="size-4 text-muted-foreground" aria-hidden="true" />
            )}
            {course.isPublished ? "Unpublish course" : "Publish course"}
          </DropdownMenuItem>
        )}
        {canPublish && coreHref && <DropdownMenuSeparator />}
        {coreHref && (
          <DropdownMenuItem asChild className="gap-2">
            <a href={coreHref}>
              <IconExternalLink className="size-4 text-muted-foreground" aria-hidden="true" />
              Open in EduAI
            </a>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type CardProps = {
  course: Course;
  kind: TeachingCourseKind;
  links: CourseLink[];
  canPublish: boolean;
  onTogglePublish: (course: Course) => void;
  /** e.g. a "Synced from EduAI" chip. */
  extraBadges?: ReactNode;
  /** One level below whatever heading the card sits under. */
  headingLevel?: 3 | 4;
};

function StatusLine({ course, kind }: { course: Course; kind: TeachingCourseKind }) {
  return (
    <>
      <span>{termLabel(courseTerm(course), courseYear(course))}</span>
      {kind === "taking" ? (
        course.progress && course.progress.total > 0 ? (
          <span>{Math.round(course.progress.percentage)}% complete</span>
        ) : null
      ) : (
        <StatusBadge
          active={course.isPublished}
          activeLabel="Published"
          inactiveLabel="Unpublished"
        />
      )}
    </>
  );
}

export function CourseGridCard({
  course,
  kind,
  links,
  canPublish,
  onTogglePublish,
  extraBadges,
  headingLevel = 3,
}: CardProps) {
  // The shared card (Core's #2105 design), so Core, AI Tutor and QM match.
  const menu =
    kind !== "taking" ? (
      <CourseMenu
        course={course}
        canPublish={canPublish}
        onBanner
        onTogglePublish={onTogglePublish}
      />
    ) : null;
  const progress = course.progress;
  return (
    <CourseTile
      code={courseCode(course)}
      title={courseName(course)}
      term={courseTerm(course)}
      year={courseYear(course)}
      accent={accentForCourse(course)}
      href={courseHref(course, kind)}
      LinkComponent={Link}
      links={links}
      publishState={kind === "taking" ? undefined : course.isPublished}
      meta={
        <>
          {kind === "taking" && progress && progress.total > 0 && (
            <span>{Math.round(progress.percentage)}% complete</span>
          )}
          {extraBadges}
        </>
      }
      menu={menu}
      headingLevel={headingLevel}
    />
  );
}

function CourseListRow({ course, kind, links, canPublish, onTogglePublish }: CardProps) {
  const accent = accentForCourse(course);
  return (
    <li
      className="relative flex flex-wrap items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-muted/40"
      style={courseThemeVars(accent)}
    >
      <span
        className="h-9 w-1.5 shrink-0 rounded-full"
        style={{ background: accent }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <Link
          to={courseHref(course, kind)}
          className="block truncate text-sm font-semibold text-foreground after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
        >
          {courseCode(course)} · {courseName(course)}
        </Link>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <StatusLine course={course} kind={kind} />
        </p>
      </div>
      {links.length > 0 && (
        <nav
          aria-label={`${courseCode(course)} sections`}
          className="flex shrink-0 items-center gap-0.5"
        >
          {links.map((link) => (
            <CourseLinkButton key={link.key} link={link} />
          ))}
        </nav>
      )}
      {kind !== "taking" && (
        <div className="relative z-10 shrink-0">
          <CourseMenu
            course={course}
            canPublish={canPublish}
            onBanner={false}
            onTogglePublish={onTogglePublish}
          />
        </div>
      )}
    </li>
  );
}

function SidePanel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title}>
      <div className="mb-2 flex items-center justify-between border-b border-border pb-1.5">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Unpublished courses, each one click from publishing. */
function DraftsPanel({
  drafts,
  canPublish,
  onTogglePublish,
}: {
  drafts: Course[];
  canPublish: boolean;
  onTogglePublish: (course: Course) => void;
}) {
  if (drafts.length === 0) {
    return <p className="text-sm text-muted-foreground">Every course here is published.</p>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {drafts.slice(0, 5).map((course) => (
        <li key={course.id} className="flex items-center gap-2 py-1">
          <span
            className="h-7 w-1 shrink-0 rounded-full"
            style={{ background: accentForCourse(course) }}
            aria-hidden="true"
          />
          <Link
            to={`/instructor/courses/${course.id}`}
            className="min-w-0 flex-1 truncate text-sm text-foreground hover:underline"
          >
            <span className="font-medium">{courseCode(course)}</span>
            <span className="sr-only"> · {courseName(course)}</span>
            <span className="block truncate text-xs text-muted-foreground" aria-hidden="true">
              {courseName(course)}
            </span>
          </Link>
          {canPublish && (
            <button
              type="button"
              onClick={() => onTogglePublish(course)}
              className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-primary-text hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Publish ${courseCode(course)}`}
            >
              Publish
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function AtAGlance({ stats }: { stats: DashboardStatDef[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm" data-tour="dashboard-stats">
      {stats.map((s) => (
        <div key={s.label} className="flex flex-col">
          <dt className="text-xs text-muted-foreground">{s.label}</dt>
          <dd className="text-base font-semibold text-foreground tabular-nums">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export type TeachingSection = { kind: TeachingCourseKind; courses: Course[] };

export function TeachingDashboard({
  sections,
  courseTotal,
  stats,
  showDrafts,
}: {
  sections: TeachingSection[];
  /** Full course count (#1208); the grid shows one bounded page. */
  courseTotal?: number;
  stats: DashboardStatDef[];
  /** Instructors and unit admins see their unpublished courses on the side. */
  showDrafts: boolean;
}) {
  const [view, setView] = useCourseView();
  const perms = useAtPermissions();
  const { requestToggle: setPending, dialog: publishDialog } = useCoursePublishToggle();
  const canPublish = perms.canPublishContent;

  const linksFor = useStaffCourseLinks();

  const visible = sections.filter((s) => s.courses.length > 0);
  const shown = sections.reduce((n, s) => n + s.courses.length, 0);
  const drafts = sections
    .filter((s) => s.kind !== "taking")
    .flatMap((s) => s.courses)
    .filter((c) => !c.isPublished);

  return (
    <div className="grid gap-8 @4xl/dashboard:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-6" data-tour="dashboard-courses">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Courses</h2>
          <div className="flex items-center gap-3">
            {courseTotal !== undefined && courseTotal > shown && (
              <Link
                to="/instructor"
                className="text-xs font-medium text-primary-text hover:underline"
              >
                All {courseTotal.toLocaleString()} courses
              </Link>
            )}
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={view}
              onValueChange={(v) => (v === "card" || v === "list") && setView(v)}
              aria-label="Course layout"
            >
              <ToggleGroupItem value="card" aria-label="Card view">
                <IconLayoutGrid className="size-4" aria-hidden="true" />
              </ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="List view">
                <IconList className="size-4" aria-hidden="true" />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        {visible.length === 0 && (
          <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center">
            <p className="text-sm text-muted-foreground text-balance">
              You don't have any courses yet. Courses are created in EduAI and appear here once
              they're set up.
            </p>
            <a
              href={`${getEduAiAppUrl()}/courses`}
              className="mt-2 inline-block text-xs font-medium text-primary-text hover:underline"
            >
              Go to EduAI courses
            </a>
          </div>
        )}

        {visible.map(({ kind, courses }) => (
          <section key={kind} aria-label={SECTION_TITLES[kind]} className="flex flex-col gap-3">
            {visible.length > 1 && (
              <h3 className="text-sm font-semibold text-muted-foreground">
                {SECTION_TITLES[kind]}
                <span className="ml-1.5 font-normal">({courses.length})</span>
              </h3>
            )}
            {view === "card" ? (
              <div className="grid grid-cols-1 gap-4 @md/dashboard:grid-cols-2 @3xl/dashboard:grid-cols-3">
                {courses.map((course) => (
                  <CourseGridCard
                    key={course.id}
                    course={course}
                    kind={kind}
                    links={linksFor(course, kind)}
                    canPublish={canPublish}
                    onTogglePublish={setPending}
                    headingLevel={visible.length > 1 ? 4 : 3}
                  />
                ))}
              </div>
            ) : (
              <ul className="overflow-hidden rounded-lg border border-border bg-card">
                {courses.map((course) => (
                  <CourseListRow
                    key={course.id}
                    course={course}
                    kind={kind}
                    links={linksFor(course, kind)}
                    canPublish={canPublish}
                    onTogglePublish={setPending}
                  />
                ))}
              </ul>
            )}
          </section>
        ))}

        <TruncatedListNotice
          shown={shown}
          total={courseTotal}
          action="open All courses to find the rest"
        />
      </div>

      <aside className="flex flex-col gap-6" aria-label="Activity">
        {/* The shell's Getting started card renders here instead of taking its own column. */}
        <div data-onboarding-slot="" className="empty:hidden" />
        {showDrafts && (
          <SidePanel
            title="Needs attention"
            action={
              <Link
                to="/instructor?status=draft"
                className="flex items-center gap-0.5 text-xs font-medium text-primary-text hover:underline"
              >
                All drafts <IconChevronRight size={13} aria-hidden="true" />
              </Link>
            }
          >
            <div data-tour="dashboard-needs-attention">
              <DraftsPanel drafts={drafts} canPublish={canPublish} onTogglePublish={setPending} />
            </div>
          </SidePanel>
        )}
        <SidePanel title="At a glance">
          <AtAGlance stats={stats} />
        </SidePanel>
      </aside>

      {publishDialog}
    </div>
  );
}
