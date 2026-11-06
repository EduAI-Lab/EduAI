/**
 * @file The learner/teacher dashboard (#2105): a Canvas-style course grid first,
 * each card carrying its course's chat and tools, with the activity summary in
 * a slim side column. ADMIN and UNIT_ADMIN keep `DashboardView`.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link, useRevalidator } from "react-router";
import {
  IconChevronRight,
  IconDotsVertical,
  IconFiles,
  IconLayoutGrid,
  IconList,
  IconMessages,
  IconRobot,
  IconSettings,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  courseThemeVars,
  termLabel,
  visibleAppsForRole,
} from "@eduai/ui";

import type { DashboardStatDef, DashboardCourse } from "~/components/dashboard/dashboard-view";
import { RecentChatsPanel } from "~/components/dashboard/dashboard-view";
import type { DashboardData } from "~/lib/dashboard/dashboard-data.server";
import { CourseCardCustomizePopover } from "~/components/courses/course-card-customize-popover";
import { CoursePublishControl } from "~/components/courses/course-publish-control";
import { usePolicyGate } from "~/components/policy/policy-gate";
import { useCourseCardPreferences } from "~/hooks/use-course-card-preferences";
import {
  getCourseDisplayName,
  resolveCourseAccentColor,
} from "~/lib/courses/course-card-preferences";
import { setCoursePublished } from "~/lib/courses/set-course-published";
import { getLauncherApps } from "~/lib/apps";
import { extensionIcon } from "~/components/layout/core-nav-model";

export type CourseDashboardRole = "INSTRUCTOR" | "TA" | "STUDENT";
type CourseView = "card" | "list";
export type CourseKind = "teaching" | "assisting" | "taking";

const VIEW_STORAGE_KEY = "eduai.dashboard.courseView";

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

function courseKind(course: DashboardCourse): CourseKind {
  if (course.callerEnrollmentRole === "INSTRUCTOR") return "teaching";
  if (course.callerEnrollmentRole === "TA") return "assisting";
  return "taking";
}

const SECTION_TITLES = {
  teaching: "Courses you teach",
  assisting: "Courses you assist",
  taking: "Courses you're taking",
} satisfies Record<CourseKind, string>;

type CourseLink = {
  key: string;
  label: string;
  icon: Icon;
  href?: string;
  external?: boolean;
  /** Shown instead of a link when the destination can't open yet. */
  disabledReason?: string;
};

/**
 * What a card offers. Learners: their course chat, then the extensions. Staff:
 * materials, the course assistant (published courses only — `/instructor/chat`
 * loads nothing else), and the extensions.
 */
export function courseLinks(
  course: DashboardCourse,
  kind: CourseKind,
  extensions: { id: string; name: string; url: string }[],
): CourseLink[] {
  const id = encodeURIComponent(course.id);
  const links: CourseLink[] = [];
  if (kind === "teaching") {
    links.push({
      key: "materials",
      label: "Materials",
      icon: IconFiles,
      href: `/courses/${id}?tab=materials`,
    });
    links.push(
      course.isPublished
        ? {
            key: "assistant",
            label: "Assistant",
            icon: IconRobot,
            href: `/instructor/chat?courseId=${id}`,
          }
        : {
            key: "assistant",
            label: "Assistant",
            icon: IconRobot,
            disabledReason: "Publish this course to open the course assistant",
          },
    );
  } else if (kind === "assisting") {
    links.push({
      key: "materials",
      label: "Materials",
      icon: IconFiles,
      href: `/courses/${id}?tab=materials`,
    });
  } else {
    links.push({ key: "chat", label: "Chat", icon: IconMessages, href: `/chat?courseId=${id}` });
  }
  for (const app of extensions) {
    links.push({
      key: app.id,
      label: app.name,
      icon: extensionIcon(app.id),
      href: app.url,
      external: true,
    });
  }
  return links;
}

/** Cards show icon buttons (Canvas-style) named by a tooltip; list rows also show the label. */
function CourseLinkButton({ link, iconOnly }: { link: CourseLink; iconOnly?: boolean }) {
  const className = cn(
    "relative z-10 inline-flex items-center gap-1.5 rounded-md text-xs font-medium transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    iconOnly ? "size-9 justify-center" : "px-2 py-1.5",
  );
  const content = (
    <>
      <link.icon className={iconOnly ? "size-5" : "size-4 shrink-0"} aria-hidden="true" />
      <span className={cn(iconOnly && "sr-only")}>{link.label}</span>
    </>
  );
  const tip = link.href ? link.label : `${link.label}: ${link.disabledReason}`;
  let control: ReactNode;
  if (!link.href) {
    control = (
      <span
        aria-disabled="true"
        tabIndex={0}
        className={cn(className, "cursor-not-allowed text-muted-foreground/60")}
      >
        {content}
      </span>
    );
  } else {
    const linkClass = cn(className, "text-[var(--course-accent)] hover:bg-[var(--course-muted)]");
    control = link.external ? (
      <a href={link.href} className={linkClass}>
        {content}
      </a>
    ) : (
      <Link to={link.href} className={linkClass}>
        {content}
      </Link>
    );
  }
  if (!iconOnly && link.href) return control;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{control}</TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

function TeachingMenu({
  course,
  canPublish,
  onBanner,
}: {
  course: DashboardCourse;
  canPublish: boolean;
  /** Drawn on the card's colour banner rather than a neutral row. */
  onBanner: boolean;
}) {
  const revalidator = useRevalidator();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const id = encodeURIComponent(course.id);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${course.code} actions`}
            className={cn(
              "flex size-8 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2",
              onBanner
                ? "text-white/90 hover:bg-white/20 focus-visible:ring-white"
                : "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring",
            )}
          >
            <IconDotsVertical className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[190px]">
          {canPublish && (
            <>
              <DropdownMenuItem className="gap-2" onSelect={() => setConfirmOpen(true)}>
                {course.isPublished ? (
                  <IconWorldOff className="size-4 text-muted-foreground" />
                ) : (
                  <IconWorldUpload className="size-4 text-muted-foreground" />
                )}
                {course.isPublished ? "Unpublish course" : "Publish course"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem asChild className="gap-2">
            <Link to={`/courses/${id}?tab=settings`}>
              <IconSettings className="size-4 text-muted-foreground" />
              Course settings
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {canPublish && (
        <CoursePublishControl
          courseLabel={`${course.code} — ${course.name}`}
          isPublished={course.isPublished}
          confirmOpen={confirmOpen}
          onConfirmOpenChange={setConfirmOpen}
          onPublishChange={async (publish) => {
            await setCoursePublished(course.id, publish);
            await revalidator.revalidate();
          }}
        />
      )}
    </>
  );
}

type CardProps = {
  course: DashboardCourse;
  kind: CourseKind;
  links: CourseLink[];
  canPublish: boolean;
};

function useCardLook(course: DashboardCourse) {
  const { getCoursePreference, setCoursePreference } = useCourseCardPreferences();
  const preference = getCoursePreference(course.id);
  return {
    preference,
    accent: resolveCourseAccentColor(course.id, preference),
    title: getCourseDisplayName(course.name, preference),
    onApply: (update: Parameters<typeof setCoursePreference>[1]) =>
      setCoursePreference(course.id, update),
  };
}

function CardMenu({
  course,
  kind,
  canPublish,
  onBanner = true,
}: Omit<CardProps, "links"> & { onBanner?: boolean }) {
  const look = useCardLook(course);
  return kind === "teaching" ? (
    <TeachingMenu course={course} canPublish={canPublish} onBanner={onBanner} />
  ) : (
    <CourseCardCustomizePopover
      courseName={course.name}
      courseCode={course.code}
      preference={look.preference}
      onApply={look.onApply}
    />
  );
}

function CourseGridCard({ course, kind, links, canPublish }: CardProps) {
  const look = useCardLook(course);
  const term = termLabel(course.term, course.year);
  return (
    <article
      className="group/card relative flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xs transition-shadow hover:shadow-md"
      style={courseThemeVars(look.accent)}
    >
      <div className="relative h-24 shrink-0" style={{ background: look.accent }}>
        <div className="absolute right-2 top-2 z-10">
          <CardMenu course={course} kind={kind} canPublish={canPublish} />
        </div>
      </div>
      <Link
        to={`/courses/${encodeURIComponent(course.id)}`}
        className="absolute inset-0 z-0"
        aria-label={`${course.code} ${look.title}`}
      />
      <div className="pointer-events-none flex flex-1 flex-col gap-1 px-4 pt-3 pb-2">
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-[var(--course-accent)]">
          {course.code} · {look.title}
        </h3>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{term}</span>
          {kind === "teaching" && (
            <StatusBadge
              active={course.isPublished}
              activeLabel="Published"
              inactiveLabel="Unpublished"
            />
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 border-t border-border px-2 py-1">
        {links.map((link) => (
          <CourseLinkButton key={link.key} link={link} iconOnly />
        ))}
      </div>
    </article>
  );
}

function CourseListRow({ course, kind, links, canPublish }: CardProps) {
  const look = useCardLook(course);
  return (
    <li
      className="relative flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-muted/40"
      style={courseThemeVars(look.accent)}
    >
      <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ background: look.accent }} />
      <Link
        to={`/courses/${encodeURIComponent(course.id)}`}
        className="absolute inset-0 z-0"
        aria-label={`${course.code} ${look.title}`}
      />
      <div className="pointer-events-none min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {course.code} · {look.title}
        </p>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          {termLabel(course.term, course.year)}
          {kind === "teaching" && (
            <StatusBadge
              active={course.isPublished}
              activeLabel="Published"
              inactiveLabel="Unpublished"
            />
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {links.map((link) => (
          <CourseLinkButton key={link.key} link={link} />
        ))}
      </div>
      {kind === "teaching" && (
        <div className="relative z-10 shrink-0">
          <CardMenu course={course} kind={kind} canPublish={canPublish} onBanner={false} />
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
    <section>
      <div className="mb-2 flex items-center justify-between border-b border-border pb-1.5">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function AtAGlance({ stats, data }: { stats: DashboardStatDef[]; data: DashboardData }) {
  const status = data.stats.materialsByStatus;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      {stats.map((s) => (
        <div key={s.label} className="flex flex-col">
          <dt className="text-xs text-muted-foreground">{s.label}</dt>
          <dd className="font-semibold text-foreground">{s.value}</dd>
        </div>
      ))}
      {status && (status.processing > 0 || status.failed > 0) && (
        <div className="col-span-2 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground">
          {status.processing > 0 && <span>{status.processing} processing</span>}
          {status.processing > 0 && status.failed > 0 && " · "}
          {status.failed > 0 && (
            <span className="font-medium text-destructive">{status.failed} failed</span>
          )}
        </div>
      )}
    </dl>
  );
}

export function CourseDashboard({
  role,
  userRole,
  launcherRole,
  data,
  stats,
  emptyMessage,
}: {
  role: CourseDashboardRole;
  /** The platform role, for which extensions the viewer may open. */
  userRole: string | null | undefined;
  /** The role the app switcher gates by ("TA" for a TA-enrolled student). */
  launcherRole: string;
  data: DashboardData;
  stats: DashboardStatDef[];
  emptyMessage?: string;
}) {
  const [view, setView] = useCourseView();
  const { isEnabled } = usePolicyGate();
  const canPublish = userRole === "INSTRUCTOR" && isEnabled("instructors.canPublishCourses");

  const extensionsFor = (courseId: string) =>
    visibleAppsForRole(getLauncherApps(courseId), launcherRole).filter(
      (app) => app.id !== "core" && app.id !== "course-chat" && app.url,
    );

  const order: CourseKind[] = ["teaching", "assisting", "taking"];
  const sections = order
    .map((kind) => ({ kind, courses: data.courses.filter((c) => courseKind(c) === kind) }))
    .filter((s) => s.courses.length > 0);
  const singleSection = role === "STUDENT" && sections.length <= 1;
  const newChatHref = data.courses.some((c) => courseKind(c) === "teaching")
    ? "/instructor/chat"
    : "/chat";

  return (
    <div className="@container/dashboard px-4 pb-8 lg:px-6">
      <div className="grid gap-8 @4xl/dashboard:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-6" data-tour="dashboard-courses">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-foreground">
              {singleSection ? "Your courses" : "Courses"}
            </h2>
            <div className="flex items-center gap-3">
              {data.courseTotal > data.courses.length && (
                <Link
                  to="/courses"
                  className="text-xs font-medium text-primary-text hover:underline"
                >
                  All {data.courseTotal} courses
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
                  <IconLayoutGrid className="size-4" />
                </ToggleGroupItem>
                <ToggleGroupItem value="list" aria-label="List view">
                  <IconList className="size-4" />
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>

          {sections.length === 0 && (
            <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center">
              <p className="text-sm text-muted-foreground text-balance">
                {emptyMessage ?? "You don't have any courses yet."}
              </p>
              {!emptyMessage && (
                <Link
                  to="/courses"
                  className="mt-2 inline-block text-xs font-medium text-primary-text hover:underline"
                >
                  Go to Courses
                </Link>
              )}
            </div>
          )}

          {sections.map(({ kind, courses }) => (
            <section key={kind} aria-label={SECTION_TITLES[kind]} className="flex flex-col gap-3">
              {!singleSection && (
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
                      canPublish={canPublish}
                      links={courseLinks(course, kind, extensionsFor(course.id))}
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
                      canPublish={canPublish}
                      links={courseLinks(course, kind, extensionsFor(course.id))}
                    />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <aside className="flex flex-col gap-6" aria-label="Activity">
          {/* The shell's Getting started card renders here instead of taking its own column. */}
          <div data-onboarding-slot="" className="empty:hidden" />
          <SidePanel
            title="Recent conversations"
            action={
              <Link
                to={newChatHref}
                className="flex items-center gap-0.5 text-xs font-medium text-primary-text hover:underline"
              >
                New chat <IconChevronRight size={13} />
              </Link>
            }
          >
            <div className="[&>div]:h-auto">
              <RecentChatsPanel chats={data.recentChats.slice(0, 4)} loading={false} />
            </div>
          </SidePanel>
          <SidePanel title="At a glance">
            <AtAGlance stats={stats} data={data} />
          </SidePanel>
        </aside>
      </div>
    </div>
  );
}
