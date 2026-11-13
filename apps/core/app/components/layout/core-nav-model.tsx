import * as React from "react";
import { useLocation, useRouteLoaderData, useSubmit } from "react-router";
import {
  IconBooks,
  IconBrain,
  IconClockCog,
  IconKey,
  IconDashboard,
  IconFileText,
  IconHelp,
  IconListCheck,
  IconMail,
  IconMessageChatbot,
  IconMessages,
  IconPuzzle,
  IconReport,
  IconRobot,
  IconSettings,
  IconShieldLock,
  IconUsers,
  type Icon,
} from "@tabler/icons-react";

import {
  Badge,
  cn,
  isNavHrefActive,
  termLabel,
  visibleAppsForRole,
  type LauncherApp,
  type NavShellCourse,
  type NavShellEntry,
  type NavShellLink,
  type NavShellModel,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@eduai/ui";
import type { User } from "~/lib/auth/types";
import { CURRENT_APP_ID, getLauncherApps } from "~/lib/apps";
import { getNavForUser, getNavSecondaryForUser, type NavItemKey } from "~/lib/rbac";
import { usePolicyGate } from "~/components/policy/policy-gate";
import { useCronJobStatuses, type CronStatusColor } from "~/hooks/api/use-cron-job-status";
import { useAdminNavCounts } from "~/hooks/api/use-admin-nav-counts";
import type { loader as rootLoader } from "~/root";

export const NAV_ICONS = {
  dashboard: IconDashboard,
  courses: IconBooks,
  chat: IconMessages,
  "question-maker": IconListCheck,
  "admin-group": IconShieldLock,
  "admin-users": IconUsers,
  "admin-ai": IconBrain,
  "admin-bugs": IconReport,
  "admin-chat": IconRobot,
  "instructor-chat": IconRobot,
  "admin-invites": IconMail,
  "admin-settings": IconShieldLock,
  "admin-logs": IconFileText,
  "unitadmin-invites": IconMail,
  "admin-cron": IconClockCog,
  "admin-api-access": IconKey,
  settings: IconSettings,
  help: IconHelp,
  "ai-tutor": IconMessageChatbot,
} satisfies Record<NavItemKey, Icon>;

/** How many courses the Courses tray lists before deferring to "All courses". */
const NAV_COURSES_PAGE_SIZE = 20;

type ApiCourse = {
  id: string;
  code: string;
  name: string;
  term?: string | null;
  year?: number | null;
};

/**
 * The Courses tray list, each course linked by `hrefFor` (its course page in
 * Core, its chat in Course Chat). `/api/courses` already scopes it to what
 * this user may see.
 */
export async function loadNavCourses(
  hrefFor: (courseId: string) => string,
): Promise<NavShellCourse[]> {
  const res = await fetch(`/api/courses?page=1&pageSize=${NAV_COURSES_PAGE_SIZE}`);
  if (!res.ok) throw new Error(String(res.status));
  const data = (await res.json()) as { data?: ApiCourse[] };
  return (data.data ?? []).map((course) => ({
    id: course.id,
    href: hrefFor(course.id),
    code: course.code,
    name: course.name,
    subtitle: course.term || course.year != null ? termLabel(course.term, course.year) : "",
  }));
}

const BADGE_COLORS = {
  green: "var(--color-badge-green)",
  orange: "var(--color-badge-orange)",
  red: "var(--color-badge-red)",
} satisfies Record<CronStatusColor, string>;

const CRON_STATUS_TIPS = {
  green: "All cron jobs' last runs succeeded",
  orange: "A cron job is running",
  red: "A cron job's last run failed",
} satisfies Record<CronStatusColor, string>;

export function CronBadgeDot({ color }: { color: CronStatusColor }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={`Cron status: ${color}`}
          role="img"
          className={cn(
            "ml-auto size-2 shrink-0 rounded-full",
            color === "orange" && "animate-pulse",
          )}
          style={{ background: BADGE_COLORS[color] }}
        />
      </TooltipTrigger>
      <TooltipContent side="right">{CRON_STATUS_TIPS[color]}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Core's navigation model for the shared `NavShell` (rail, trays, mobile
 * drawer). It reads the same RBAC sources the old sidebar did
 * (`getNavForUser` / `getNavSecondaryForUser`, the root loader's policy flags)
 * and only reshapes them: the Administration group becomes a tray, Help becomes
 * a tray holding the guide and the bug report, and the user menu becomes the
 * Account tray.
 */
/**
 * What Core's and Course Chat's nav models share: the signed-in user, the
 * Account and Help trays, the app switcher's list, and logging out.
 */
export function useSharedNavParts(
  user: User,
  onReportBug?: () => void,
): Omit<NavShellModel, "entries" | "adminLinks" | "currentAppId"> {
  const { pathname } = useLocation();
  const submit = useSubmit();
  const rootData = useRouteLoaderData<typeof rootLoader>("root");
  const coreCourseId = pathname.match(/^\/courses\/([^/]+)/)?.[1] ?? null;
  const launcherRole = rootData?.hasTeachingAssistantEnrollment ? "TA" : user.role;
  const onLogout = React.useCallback(
    () => submit(null, { method: "post", action: "/auth/logout", replace: true }),
    [submit],
  );
  return {
    pathname,
    user: { name: user.name, email: user.email, image: user.image, role: user.role },
    accountLinks: [{ key: "settings", label: "Settings", href: "/settings", icon: IconSettings }],
    helpLinks: [{ key: "help", label: "Help & guide", href: "/help", icon: IconHelp }],
    launcherApps: visibleAppsForRole(getLauncherApps(coreCourseId), launcherRole),
    onLogout,
    onReportBug,
  };
}

/** Rail entries that belong to the Course Chat app instead of Core's rail (#1996). */
const COURSE_CHAT_KEYS = new Set<NavItemKey>(["chat", "instructor-chat"]);

export function useCoreNavModel(user: User, onReportBug?: () => void): NavShellModel {
  const { isEnabled } = usePolicyGate();
  const shared = useSharedNavParts(user, onReportBug);
  const { pathname } = shared;
  // Prefer the server-resolved flags from the root loader (authoritative,
  // default-aware, no paint flash); fall back to the SSR-seeded policy gate.
  const rootData = useRouteLoaderData<typeof rootLoader>("root");

  // One shared store polls for every subscriber, so the cron page's own
  // subscription joins this one's loop instead of starting a second.
  const isAdmin = user.role === "ADMIN";
  const cronStatus = useCronJobStatuses(isAdmin);
  const cronStatusColor = cronStatus.color;
  const failedCronJobs = cronStatus.jobs.filter((job) => job.lastRun?.status === "ERROR").length;
  const navCounts = useAdminNavCounts(isAdmin && pathname.startsWith("/admin/"), pathname);

  const navItems = getNavForUser(user, {
    canInvite: rootData?.canInvite ?? isEnabled("unitAdmins.canInvite"),
  });
  // #1666 review: Course Assistant must survive navigation beyond /dashboard, so
  // its gate comes from the root loader rather than the raw session user.
  const secondaryItems = getNavSecondaryForUser({
    ...user,
    canUseCourseAssistant: rootData?.canUseCourseAssistant,
  });

  const entries: NavShellEntry[] = [];
  let adminLinks: NavShellLink[] = [];

  for (const item of navItems) {
    if ("children" in item) {
      adminLinks = item.children.map((child) => ({
        ...toNavLink(child),
        badge: adminLinkBadge(child.url, {
          cronStatusColor,
          failedCronJobs,
          unhandledBugReports: navCounts?.unhandledBugReports,
          pendingInvitations: navCounts?.pendingInvitations,
        }),
      }));
      // Every admin page shows the Administration menu beside it, so the rail
      // tile goes straight to the first page instead of opening the tray.
      entries.push({
        kind: "tray",
        tray: "admin",
        label: item.title,
        icon: NAV_ICONS[item.key],
        href: adminLinks.find((link) => !link.disabled)?.href,
      });
    } else if (item.key === "courses") {
      entries.push({ kind: "tray", tray: "courses", label: item.title, icon: NAV_ICONS.courses });
    } else {
      entries.push({ kind: "link", link: toNavLink(item) });
    }
  }

  // #2105: learners and teaching staff get Course Chat and the extensions as
  // rail entries (Canvas-style) instead of hunting for them in the app switcher.
  const flattenApps = !ADMIN_ROLES.has(user.role ?? "");
  for (const item of secondaryItems) {
    if (COURSE_CHAT_KEYS.has(item.key) && !flattenApps) continue;
    if (item.key === "help") {
      if (flattenApps) entries.push(...extensionEntries(shared.launcherApps));
      entries.push({ kind: "tray", tray: "help", label: "Help", icon: NAV_ICONS.help });
    } else {
      entries.push({ kind: "link", link: toNavLink(item) });
    }
  }

  return {
    ...shared,
    entries,
    adminLinks,
    coursesHref: "/courses",
    loadCourses: loadCoreNavCourses,
    currentAppId: CURRENT_APP_ID,
  };
}

/** A count badge for an Administration link; nothing for a zero or unknown count. */
function CountBadge({
  count,
  label,
  variant = "muted",
}: {
  count: number | undefined;
  label: string;
  variant?: "muted" | "destructive";
}) {
  if (!count) return null;
  return (
    <Badge variant={variant} size="sm" className="ml-auto" aria-label={`${count} ${label}`}>
      {count}
    </Badge>
  );
}

function adminLinkBadge(
  url: string,
  counts: {
    cronStatusColor: CronStatusColor | null;
    failedCronJobs: number;
    unhandledBugReports?: number;
    pendingInvitations?: number;
  },
): React.ReactNode {
  if (isNavHrefActive(url, "/admin/bug-reports")) {
    return <CountBadge count={counts.unhandledBugReports} label="unhandled" />;
  }
  if (isNavHrefActive(url, "/admin/invitations")) {
    return <CountBadge count={counts.pendingInvitations} label="pending" />;
  }
  if (isNavHrefActive(url, "/admin/cron-jobs")) {
    // Failures show as a count; otherwise the status dot (running, all good) stays.
    if (counts.failedCronJobs > 0) {
      return <CountBadge count={counts.failedCronJobs} label="failed" variant="destructive" />;
    }
    return counts.cronStatusColor ? <CronBadgeDot color={counts.cronStatusColor} /> : undefined;
  }
  return undefined;
}

/** Roles whose rail keeps the app switcher as the only way to other apps. */
export const ADMIN_ROLES = new Set(["ADMIN", "UNIT_ADMIN"]);

const EXTENSION_ICONS = new Map<string, Icon>([
  ["ai-tutor", IconMessageChatbot],
  ["question-maker", IconListCheck],
]);

/** An extension's rail/card icon; unknown extras get the puzzle piece. */
export function extensionIcon(appId: string): Icon {
  return EXTENSION_ICONS.get(appId) ?? IconPuzzle;
}

/** Rail links for the role-visible extensions (AI Tutor, Question Maker, extras). */
export function extensionEntries(apps: LauncherApp[]): NavShellEntry[] {
  return apps
    .filter((app) => app.id !== CURRENT_APP_ID && app.id !== "course-chat" && app.url)
    .map((app) => ({
      kind: "link",
      link: {
        key: `app-${app.id}`,
        label: app.name,
        href: app.url,
        icon: extensionIcon(app.id),
        external: true,
      },
    }));
}

const loadCoreNavCourses = () => loadNavCourses((courseId) => `/courses/${courseId}`);

function toNavLink(item: ReturnType<typeof getNavSecondaryForUser>[number]): NavShellLink {
  return {
    key: item.key,
    label: item.title,
    href: item.url,
    icon: NAV_ICONS[item.key],
    disabled: item.disabled,
    disabledReason: item.disabledReason,
  };
}
