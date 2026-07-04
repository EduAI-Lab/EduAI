/**
 * Global ⌘K / Ctrl-K command palette (issue #764 — QuestionMaker ↔ Core parity).
 * Jump to any nav destination the current user is allowed to see (RBAC reuses the
 * exact `getNavForUser` matrix the sidebar renders) or hop straight to a course.
 *
 * Mounted once in `AppSidebar`, so it rides along on every authenticated page. The
 * course list is fetched lazily the first time the palette opens — no extra
 * `/api/courses` request on pages that never trigger it.
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
  IconBook2,
  type Icon,
} from "@tabler/icons-react";

import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@eduai/ui";
import type { User } from "~/lib/auth/types";
import type { NavItem, NavItemKey } from "~/lib/rbac/types";
import { getNavForUser, getNavSecondaryForUser } from "~/lib/rbac/nav";

const NAV_ICONS: Record<NavItemKey, Icon> = {
  dashboard: IconDashboard,
  courses: IconBooks,
  chat: IconRobot,
  "question-maker": IconBooks,
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
 * dropped so the palette never routes somewhere the user can't go. Exported for
 * unit tests — the DOM-heavy Radix dialog stays untested here.
 */
export function paletteNavItems(user: User): NavItem[] {
  const settingsItem: NavItem = { key: "settings", title: "Settings", url: "/settings" };
  return [
    ...getNavForUser(user),
    ...getNavSecondaryForUser(user),
    settingsItem,
  ].filter((item) => !item.disabled);
}

export function CommandPalette({ user }: { user: User }) {
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const [courses, setCourses] = React.useState<PaletteCourse[]>([]);
  const coursesLoaded = React.useRef(false);

  // ── ⌘K / Ctrl-K toggle ─────────────────────────────────────────────────────
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Lazy-load courses on first open ─────────────────────────────────────────
  React.useEffect(() => {
    if (!open || coursesLoaded.current) return;
    coursesLoaded.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/courses");
        if (!res.ok) return;
        const data = (await res.json()) as { courses?: PaletteCourse[] };
        if (!cancelled) setCourses(data.courses ?? []);
      } catch {
        // Non-fatal: palette still works for navigation without the course list.
        coursesLoaded.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const go = React.useCallback(
    (url: string) => {
      setOpen(false);
      navigate(url);
    },
    [navigate],
  );

  // Reuse the sidebar RBAC matrix so the palette can never surface a link the
  // user isn't allowed to see.
  const navItems = paletteNavItems(user);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Jump to a page or course"
    >
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          {navItems.map((item) => {
            const ItemIcon = NAV_ICONS[item.key] ?? IconArrowRight;
            return (
              <CommandItem
                key={item.key}
                value={`nav ${item.title}`}
                onSelect={() => go(item.url)}
              >
                <ItemIcon className="size-4 text-muted-foreground" />
                <span>{item.title}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        {courses.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Courses">
              {courses.map((course) => (
                <CommandItem
                  key={course.id}
                  value={`course ${course.code} ${course.name}`}
                  onSelect={() => go(`/courses/${course.id}`)}
                >
                  <IconBook2 className="size-4 text-muted-foreground" />
                  <span className="font-medium">{course.code}</span>
                  <span className="truncate text-muted-foreground">{course.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
