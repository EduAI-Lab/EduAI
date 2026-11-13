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
  IconEdit,
  IconFiles,
  IconLayoutGrid,
  IconList,
  IconMessages,
  IconRobot,
  IconSettings,
  IconTrash,
  IconWorldOff,
  IconWorldUpload,
} from "@tabler/icons-react";
import {
  CollapsibleSection,
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
  CourseTile,
  CourseTileLinkButton,
  cn,
  courseThemeVars,
  termLabel,
  useMenuTooltip,
  visibleAppsForRole,
  type CourseTileLink,
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

/**
 * The Courses page's own actions on a teaching card (#807: an item a policy
 * turned off stays visible and greyed, with the reason under it). The page
 * runs its own publish confirmation, so the card's built-in one is skipped.
 */
export type CourseMenuActions = {
  onPublishToggle: () => void;
  publishDisabledReason?: string;
  onEdit: () => void;
  onDelete: () => void;
  deleteDisabledReason?: string;
};

/** The extensions a viewer may open from a course card. */
export function courseExtensions(courseId: string, launcherRole: string) {
  return visibleAppsForRole(getLauncherApps(courseId), launcherRole).filter(
    (app) => app.id !== "core" && app.id !== "course-chat" && app.url,
  );
}

type CourseLink = CourseTileLink;

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

function CourseLinkButton({ link, iconOnly }: { link: CourseLink; iconOnly?: boolean }) {
  return <CourseTileLinkButton link={link} iconOnly={iconOnly} LinkComponent={Link} />;
}

function TeachingMenu({
  course,
  canPublish,
  onBanner,
  actions,
}: {
  course: DashboardCourse;
  canPublish: boolean;
  /** Drawn on the card's colour banner rather than a neutral row. */
  onBanner: boolean;
  actions?: CourseMenuActions;
}) {
  const revalidator = useRevalidator();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTip = useMenuTooltip(menuOpen);
  const id = encodeURIComponent(course.id);
  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <Tooltip {...menuTip.tooltipProps}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                {...menuTip.triggerProps}
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
          </TooltipTrigger>
          <TooltipContent>Course actions</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="min-w-[190px]">
          {actions && (
            <>
              <DropdownMenuItem
                className={cn(
                  "gap-2",
                  actions.publishDisabledReason && "flex-col items-start gap-0.5",
                )}
                disabled={!!actions.publishDisabledReason}
                onSelect={actions.onPublishToggle}
              >
                <span className="flex items-center gap-2">
                  {course.isPublished ? (
                    <IconWorldOff className="size-4 text-muted-foreground" />
                  ) : (
                    <IconWorldUpload className="size-4 text-muted-foreground" />
                  )}
                  {course.isPublished ? "Unpublish course" : "Publish course"}
                </span>
                {actions.publishDisabledReason && (
                  <span className="pl-6 text-[11px] text-muted-foreground">
                    {actions.publishDisabledReason}
                  </span>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2" onSelect={actions.onEdit}>
                <IconEdit className="size-4 text-muted-foreground" />
                Edit course
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {!actions && canPublish && (
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
          {actions && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className={cn(
                  "gap-2 text-destructive focus:text-destructive",
                  actions.deleteDisabledReason &&
                    "flex-col items-start gap-0.5 text-muted-foreground focus:text-muted-foreground",
                )}
                disabled={!!actions.deleteDisabledReason}
                onSelect={actions.onDelete}
              >
                <span className="flex items-center gap-2">
                  <IconTrash className="size-4" />
                  Delete course
                </span>
                {actions.deleteDisabledReason && (
                  <span className="pl-6 text-[11px] text-muted-foreground">
                    {actions.deleteDisabledReason}
                  </span>
                )}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {!actions && canPublish && (
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
  /** Courses page only: Edit and Delete alongside the dashboard's items. */
  menuActions?: CourseMenuActions;
  /** Courses page only: e.g. the viewer's role in the course, the teaching team. */
  extraBadges?: string[];
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
  menuActions,
  onBanner = true,
}: Omit<CardProps, "links" | "extraBadges"> & { onBanner?: boolean }) {
  const look = useCardLook(course);
  return kind === "teaching" ? (
    <TeachingMenu
      course={course}
      canPublish={canPublish}
      onBanner={onBanner}
      actions={menuActions}
    />
  ) : (
    <CourseCardCustomizePopover
      courseName={course.name}
      courseCode={course.code}
      preference={look.preference}
      onApply={look.onApply}
    />
  );
}

export function CourseGridCard({
  course,
  kind,
  links,
  canPublish,
  menuActions,
  extraBadges,
}: CardProps) {
  const look = useCardLook(course);
  return (
    <CourseTile
      code={course.code}
      title={look.title}
      term={course.term}
      year={course.year}
      accent={look.accent}
      href={`/courses/${encodeURIComponent(course.id)}`}
      LinkComponent={Link}
      links={links}
      publishState={kind === "teaching" ? course.isPublished : undefined}
      extraBadges={extraBadges}
      menu={
        <CardMenu course={course} kind={kind} canPublish={canPublish} menuActions={menuActions} />
      }
    />
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
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
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

  const extensionsFor = (courseId: string) => courseExtensions(courseId, launcherRole);

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
                <h3 className="text-base font-semibold text-muted-foreground">
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
          <CollapsibleSection
            title="At a glance"
            storageKey="eduai.dashboard.analyticsCollapsed"
            headerClassName="border-b border-border pb-1.5"
          >
            <AtAGlance stats={stats} data={data} />
          </CollapsibleSection>
        </aside>
      </div>
    </div>
  );
}
