/**
 * Core's command palette — a thin adapter over the shared `@eduai/ui`
 * CommandPalette (issue #764). Builds RBAC-filtered navigation groups + a
 * course-switch group, then hands them to the shared component so the look and
 * ⌘K behaviour match QuestionMaker and AI Tutor exactly.
 *
 * Mounted once in `AppSidebar`, so it rides along on every authenticated page.
 * Courses load lazily the first time the palette opens (via the shared
 * `onOpenChange` hook) — no extra `/api/courses` request on pages that never
 * trigger it.
 */
import * as React from "react";
import { useNavigate } from "react-router";
import {
  IconDashboard,
  IconBooks,
  IconRobot,
  IconSettings,
  IconHelp,
  IconUsers,
  IconBrain,
  IconReport,
  IconMail,
  IconShieldLock,
  IconFileText,
  IconClockCog,
  IconMessageChatbot,
  IconArrowRight,
  IconLayoutGrid,
  type Icon,
} from "@tabler/icons-react";

import {
  CommandPalette as SharedCommandPalette,
  buildAppSwitcherGroup,
  type CommandPaletteGroup,
} from "@eduai/ui";
import { CURRENT_APP_ID, getLauncherApps } from "~/lib/apps";
import type { User } from "~/lib/auth/types";
import type { NavItem, NavGroupItem, NavItemKey } from "~/lib/rbac/types";
import { getNavForUser, getNavSecondaryForUser } from "~/lib/rbac/nav";

/** One bounded page at the API's max `pageSize`, for course pickers (#1041). */
const COURSE_PICKER_QUERY = "page=1&pageSize=200";


/** Window event that opens the palette — dispatched by the header search button. */
export const CORE_COMMAND_EVENT = "eduai:open-command";

const NAV_ICONS: Record<NavItemKey, Icon> = {
  dashboard: IconDashboard,
  courses: IconBooks,
  chat: IconRobot,
  "question-maker": IconBooks,
  "admin-group": IconShieldLock,
  "admin-users": IconUsers,
  "admin-ai": IconBrain,
  "admin-bugs": IconReport,
  "admin-chat": IconRobot,
  "admin-invites": IconMail,
  "admin-settings": IconShieldLock,
  "admin-logs": IconFileText,
  "unitadmin-invites": IconMail,
  "admin-cron": IconClockCog,
  settings: IconSettings,
  help: IconHelp,
  "ai-tutor": IconMessageChatbot,
};

type PaletteCourse = { id: string; code: string; name: string };

/**
 * The nav destinations the palette offers, filtered by the same RBAC matrix the
 * sidebar uses. Policy-disabled links (e.g. a gated UNIT_ADMIN invite) are
 * dropped so the palette never routes somewhere the user can't go. Grouped nav
 * entries (e.g. the collapsible admin section) are flattened to their leaf links
 * so the palette offers real destinations, not the non-navigating parent.
 * Exported for unit tests.
 */
export function paletteNavItems(user: User): NavItem[] {
  const settingsItem: NavItem = { key: "settings", title: "Settings", url: "/settings" };
  const flatten = (items: (NavItem | NavGroupItem)[]): NavItem[] =>
    items.flatMap((item) => ("children" in item ? item.children : [item]));
  return flatten([
    ...getNavForUser(user),
    ...getNavSecondaryForUser(user),
    settingsItem,
  ]).filter((item) => !item.disabled);
}

/**
 * Lazily fetch the palette's course list the first time it opens. The
 * `loadedRef` guard makes it fire at most once — but a failed attempt (HTTP
 * error OR network/parse error) must reset the guard so the next open retries.
 * A 4xx/5xx that left the guard set would permanently blank the "Switch course"
 * group. Exported for unit tests.
 */
export async function loadPaletteCourses(
  loadedRef: { current: boolean },
  setCourses: (courses: PaletteCourse[]) => void,
  open: boolean,
): Promise<void> {
  if (!open || loadedRef.current) return;
  loadedRef.current = true;
  try {
    // #1041: `/api/courses` requires paging. One bounded page at the API's
    // maximum size is enough for a palette group.
    const res = await fetch(`/api/courses?${COURSE_PICKER_QUERY}`);
    if (!res.ok) {
      loadedRef.current = false; // allow a retry after an HTTP error
      return;
    }
    const data = (await res.json()) as { data?: PaletteCourse[] };
    setCourses(data.data ?? []);
  } catch {
    loadedRef.current = false; // allow a retry on a network/parse error
  }
}

export function CommandPalette({ user }: { user: User }) {
  const navigate = useNavigate();
  const [courses, setCourses] = React.useState<PaletteCourse[]>([]);
  const coursesLoaded = React.useRef(false);

  const loadCoursesOnOpen = React.useCallback(
    (open: boolean) => void loadPaletteCourses(coursesLoaded, setCourses, open),
    [],
  );

  const groups: CommandPaletteGroup[] = [
    {
      heading: "Go to",
      items: paletteNavItems(user).map((item) => {
        const ItemIcon = NAV_ICONS[item.key] ?? IconArrowRight;
        return {
          label: item.title,
          value: `nav ${item.title}`,
          icon: <ItemIcon className="size-4 text-muted-foreground" />,
          onSelect: () => navigate(item.url),
        };
      }),
    },
    {
      heading: "Switch course",
      items: courses.map((course) => ({
        label: course.code,
        sublabel: course.name,
        value: `course ${course.code} ${course.name}`,
        icon: <IconLayoutGrid className="size-4 text-muted-foreground" />,
        onSelect: () => navigate(`/courses/${course.id}`),
      })),
    },
    buildAppSwitcherGroup({
      apps: getLauncherApps(),
      currentAppId: CURRENT_APP_ID,
      role: user.role,
    }),
  ];

  return (
    <SharedCommandPalette
      groups={groups}
      openEventName={CORE_COMMAND_EVENT}
      onOpenChange={loadCoursesOnOpen}
    />
  );
}
