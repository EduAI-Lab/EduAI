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
  IconReport,
  IconRobot,
  IconSettings,
  IconShieldLock,
  IconUsers,
  type Icon,
} from "@tabler/icons-react";

import {
  cn,
  termLabel,
  visibleAppsForRole,
  type NavShellCourse,
  type NavShellEntry,
  type NavShellLink,
  type NavShellModel,
} from "@eduai/ui";
import type { User } from "~/lib/auth/types";
import { CURRENT_APP_ID, getLauncherApps } from "~/lib/apps";
import { getNavForUser, getNavSecondaryForUser, type NavItemKey } from "~/lib/rbac";
import { usePolicyGate } from "~/components/policy/policy-gate";
import { useCronJobStatus, type CronStatusColor } from "~/hooks/api/use-cron-job-status";
import type { loader as rootLoader } from "~/root";

export const NAV_ICONS = {
  dashboard: IconDashboard,
  courses: IconBooks,
  chat: IconRobot,
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

/** The Courses tray list. `/api/courses` already scopes it to what this user may see. */
async function loadNavCourses(): Promise<NavShellCourse[]> {
  const res = await fetch(`/api/courses?page=1&pageSize=${NAV_COURSES_PAGE_SIZE}`);
  if (!res.ok) throw new Error(String(res.status));
  const data = (await res.json()) as { data?: ApiCourse[] };
  return (data.data ?? []).map((course) => ({
    id: course.id,
    href: `/courses/${course.id}`,
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

export function CronBadgeDot({ color }: { color: CronStatusColor }) {
  return (
    <span
      aria-label={`Cron status: ${color}`}
      role="img"
      className={cn("ml-auto size-2 shrink-0 rounded-full", color === "orange" && "animate-pulse")}
      style={{ background: BADGE_COLORS[color] }}
    />
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
export function useCoreNavModel(user: User, onReportBug?: () => void): NavShellModel {
  const { isEnabled } = usePolicyGate();
  const { pathname } = useLocation();
  const submit = useSubmit();
  const coreCourseId = pathname.match(/^\/courses\/([^/]+)/)?.[1] ?? null;
  // Prefer the server-resolved flags from the root loader (authoritative,
  // default-aware, no paint flash); fall back to the SSR-seeded policy gate.
  const rootData = useRouteLoaderData<typeof rootLoader>("root");

  // The cron admin page owns polling while it is open, so this always-mounted
  // nav never creates a concurrent request loop.
  const cronStatusColor = useCronJobStatus(
    user.role === "ADMIN" && pathname !== "/admin/cron-jobs",
  );

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
        badge:
          child.url === "/admin/cron-jobs" && cronStatusColor ? (
            <CronBadgeDot color={cronStatusColor} />
          ) : undefined,
      }));
      entries.push({ kind: "tray", tray: "admin", label: item.title, icon: NAV_ICONS[item.key] });
    } else if (item.key === "courses") {
      entries.push({ kind: "tray", tray: "courses", label: item.title, icon: NAV_ICONS.courses });
    } else {
      entries.push({ kind: "link", link: toNavLink(item) });
    }
  }

  for (const item of secondaryItems) {
    if (item.key === "help") {
      entries.push({ kind: "tray", tray: "help", label: "Help", icon: NAV_ICONS.help });
    } else {
      entries.push({ kind: "link", link: toNavLink(item) });
    }
  }

  const launcherRole = rootData?.hasTeachingAssistantEnrollment ? "TA" : user.role;
  const onLogout = React.useCallback(
    () => submit(null, { method: "post", action: "/auth/logout", replace: true }),
    [submit],
  );

  return {
    pathname,
    user: { name: user.name, email: user.email, image: user.image, role: user.role },
    entries,
    accountLinks: [{ key: "settings", label: "Settings", href: "/settings", icon: IconSettings }],
    adminLinks,
    helpLinks: [{ key: "help", label: "Help & guide", href: "/help", icon: IconHelp }],
    coursesHref: "/courses",
    loadCourses: loadNavCourses,
    launcherApps: visibleAppsForRole(getLauncherApps(coreCourseId), launcherRole),
    currentAppId: CURRENT_APP_ID,
    onLogout,
    onReportBug,
  };
}

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
