/**
 * AI Tutor's command palette — a thin adapter over the shared `@eduai/ui`
 * CommandPalette (issue #764), so the ⌘K palette looks and behaves identically
 * across Core, QuestionMaker, and AI Tutor. Navigation is RBAC-filtered (reuses
 * the sidebar's `getNavForUser`); courses load lazily on first open. Opens on ⌘K
 * or the `eduai:open-command` window event (from the header search button).
 *
 * #1208: courses are searched server-side. Passing `onQueryChange` switches the
 * shared palette to host-driven results — cmdk's own filtering is disabled,
 * because it can only ever match rows already loaded, which for a paged course
 * list is just the first page. So this component owns BOTH halves: it re-queries
 * the server for courses, and narrows the static nav/app rows itself.
 */
import * as React from 'react';
import { useNavigate } from 'react-router';
import {
  CommandPalette as SharedCommandPalette,
  buildAppSwitcherGroup,
  type CommandPaletteGroup,
  type CommandPaletteItem,
} from '@eduai/ui';
import {
  IconBooks,
  IconReport,
  IconSettings,
  IconLayoutGrid,
  IconHelpCircle,
} from '@tabler/icons-react';

import { useLocalUser } from '~/hooks/useLocalUser';
import { useDebouncedValue } from '~/hooks/useDebouncedValue';
import { CURRENT_APP_ID, getLauncherApps } from '~/lib/apps';
import { getNavForUser } from '~/lib/rbac/nav';
import type { AtNavItemKey } from '~/lib/rbac/types';
import api from '~/lib/api';
import type { Course } from '~/lib/types';

export const AITUTOR_COMMAND_EVENT = 'eduai:open-command';

const NAV_ICON: Partial<Record<AtNavItemKey, React.ReactNode>> = {
  'my-courses': <IconBooks className="size-4" />,
  teaching: <IconBooks className="size-4" />,
  'admin-courses': <IconBooks className="size-4" />,
  'admin-bug-reports': <IconReport className="size-4" />,
};

/** Local match for the static rows, standing in for the cmdk filtering we turned off. */
function matchesQuery(item: CommandPaletteItem, query: string): boolean {
  if (!query) return true;
  return `${item.value ?? ''} ${item.label}`.toLowerCase().includes(query);
}

export function CommandPalette() {
  const navigate = useNavigate();
  const { user } = useLocalUser();
  const [courses, setCourses] = React.useState<Course[]>([]);
  const [courseTotal, setCourseTotal] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const debouncedQuery = useDebouncedValue(query);

  // Only the newest request may write state — debouncing narrows the
  // out-of-order window but doesn't close it.
  const latestRequest = React.useRef(0);

  React.useEffect(() => {
    if (!open) return;
    const requestId = ++latestRequest.current;
    void (async () => {
      try {
        const page = await api.listCourses({ search: debouncedQuery.trim() || undefined });
        if (latestRequest.current !== requestId) return;
        setCourses(Array.isArray(page.data) ? page.data : []);
        setCourseTotal(typeof page.total === 'number' ? page.total : 0);
      } catch {
        // Leave whatever was already listed; the next keystroke or reopen retries.
      }
    })();
  }, [open, debouncedQuery]);

  const handleOpenChange = React.useCallback((next: boolean) => {
    setOpen(next);
    // Reset on close so reopening starts from the default (unsearched) list
    // rather than the last query's results.
    if (!next) setQuery('');
  }, []);

  if (!user) return null;

  // STUDENT stays in the /student shell; everyone else uses the /instructor shell.
  const coursePrefix = user.role === 'STUDENT' ? '/student' : '/instructor';
  const normalizedQuery = query.trim().toLowerCase();

  const navItems: CommandPaletteItem[] = [
    ...getNavForUser(user).map((item) => ({
      label: item.title,
      value: `nav ${item.title}`,
      icon: NAV_ICON[item.key] ?? <IconBooks className="size-4" />,
      onSelect: () => navigate(item.href),
    })),
    {
      label: 'Settings',
      icon: <IconSettings className="size-4" />,
      onSelect: () => navigate('/settings'),
    },
    {
      label: 'Help',
      icon: <IconHelpCircle className="size-4" />,
      onSelect: () => navigate('/help'),
    },
  ].filter((item) => matchesQuery(item, normalizedQuery));

  const courseItems: CommandPaletteItem[] = courses.map((c) => ({
    label: c.title ?? 'Untitled course',
    value: `course ${c.title ?? c.id}`,
    icon: <IconLayoutGrid className="size-4" />,
    onSelect: () => navigate(`${coursePrefix}/courses/${c.id}`),
  }));

  // Disclose the bound rather than implying the list is complete. Selecting it
  // is a no-op — it is a notice, not a destination.
  if (courseTotal > courses.length) {
    courseItems.push({
      label: `Showing ${courses.length} of ${courseTotal} courses — keep typing to narrow`,
      value: 'course truncation notice',
      onSelect: () => {},
    });
  }

  const appGroup = buildAppSwitcherGroup({
    apps: getLauncherApps(),
    currentAppId: CURRENT_APP_ID,
    role: user.role,
  });

  const groups: CommandPaletteGroup[] = [
    { heading: 'Go to', items: navItems },
    { heading: 'Switch course', items: courseItems },
    {
      ...appGroup,
      items: appGroup.items.filter((item) => matchesQuery(item, normalizedQuery)),
    },
  ].filter((group) => group.items.length > 0);

  return (
    <SharedCommandPalette
      groups={groups}
      openEventName={AITUTOR_COMMAND_EVENT}
      onOpenChange={handleOpenChange}
      onQueryChange={setQuery}
    />
  );
}
