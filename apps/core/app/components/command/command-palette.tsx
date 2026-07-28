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

/** Matches the debounce the admin table hooks use, so search feels consistent. */
const SEARCH_DEBOUNCE_MS = 300;


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
  const courses = await fetchPaletteCourses("");
  if (courses === null) {
    loadedRef.current = false; // allow a retry after an HTTP/network/parse error
    return;
  }
  setCourses(courses);
}

/**
 * Fetch one page of `/api/courses`, narrowed by `search` when the user types
 * (#1143). The page is bounded, so without a server-side `search` the palette
 * could only ever reach the first 200 courses — typing has to re-query Core
 * rather than filter the page already in memory.
 *
 * Returns `null` on any failure so callers can distinguish "no matches" from
 * "the request failed" (the latter must not blank an existing list). Exported
 * for unit tests.
 */
export async function fetchPaletteCourses(search: string): Promise<PaletteCourse[] | null> {
  const query = search ? `${COURSE_PICKER_QUERY}&search=${encodeURIComponent(search)}` : COURSE_PICKER_QUERY;
  try {
    const res = await fetch(`/api/courses?${query}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: PaletteCourse[] };
    return data.data ?? [];
  } catch {
    return null;
  }
}

/**
 * cmdk's own filtering is off once the palette is host-driven (it would filter
 * the server's page a second time and drop rows Core already matched), so the
 * static groups are narrowed here instead. Matches every whitespace-separated
 * term, so "adm us" still finds "Admin · Users".
 */
export function matchesQuery(value: string, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = value.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function CommandPalette({ user }: { user: User }) {
  const navigate = useNavigate();
  const [courses, setCourses] = React.useState<PaletteCourse[]>([]);
  const [query, setQuery] = React.useState("");
  const coursesLoaded = React.useRef(false);
  const hasSearched = React.useRef(false);

  const loadCoursesOnOpen = React.useCallback(
    (open: boolean) => void loadPaletteCourses(coursesLoaded, setCourses, open),
    [],
  );

  // #1143: re-query Core as the user types instead of filtering the loaded page.
  // Debounced, and stale responses are dropped so a slow early request can't
  // overwrite the results of a later keystroke.
  React.useEffect(() => {
    // The empty query is skipped until the user has actually searched, so this
    // never duplicates the lazy load on first open — but once they have, it must
    // run to restore the unfiltered page instead of leaving the last search's
    // results behind.
    if (query === "" && !hasSearched.current) return;
    hasSearched.current = query !== "";
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const result = await fetchPaletteCourses(query);
        // A failed request keeps the current list rather than blanking it.
        if (!cancelled && result !== null) setCourses(result);
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const navItems = paletteNavItems(user)
    .map((item) => {
      const ItemIcon = NAV_ICONS[item.key] ?? IconArrowRight;
      return {
        label: item.title,
        value: `nav ${item.title}`,
        icon: <ItemIcon className="size-4 text-muted-foreground" />,
        onSelect: () => navigate(item.url),
      };
    })
    .filter((item) => matchesQuery(item.value, query));

  const appGroup = buildAppSwitcherGroup({
    apps: getLauncherApps(),
    currentAppId: CURRENT_APP_ID,
    role: user.role,
  });

  const groups: CommandPaletteGroup[] = [
    { heading: "Go to", items: navItems },
    {
      heading: "Switch course",
      // Already narrowed by Core's `?search=` — no second client-side filter.
      items: courses.map((course) => ({
        label: course.code,
        sublabel: course.name,
        value: `course ${course.code} ${course.name}`,
        icon: <IconLayoutGrid className="size-4 text-muted-foreground" />,
        onSelect: () => navigate(`/courses/${course.id}`),
      })),
    },
    {
      ...appGroup,
      items: appGroup.items.filter((item) => matchesQuery(item.value ?? item.label, query)),
    },
  ];

  return (
    <SharedCommandPalette
      groups={groups}
      openEventName={CORE_COMMAND_EVENT}
      onOpenChange={loadCoursesOnOpen}
      onQueryChange={setQuery}
    />
  );
}
