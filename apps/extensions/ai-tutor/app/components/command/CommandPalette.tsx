/**
 * AI Tutor's command palette — a thin adapter over the shared `@eduai/ui`
 * CommandPalette (issue #764), so the ⌘K palette looks and behaves identically
 * across Core, QuestionMaker, and AI Tutor. Navigation is RBAC-filtered (reuses
 * the sidebar's `getNavForUser`); courses load lazily on first open. Opens on ⌘K
 * or the `eduai:open-command` window event (from the header search button).
 */
import * as React from 'react';
import { useNavigate } from 'react-router';
import {
  CommandPalette as SharedCommandPalette,
  buildAppSwitcherGroup,
  type CommandPaletteGroup,
} from '@eduai/ui';
import {
  IconBooks,
  IconReport,
  IconSettings,
  IconLayoutGrid,
  IconHelpCircle,
} from '@tabler/icons-react';

import { useLocalUser } from '~/hooks/useLocalUser';
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

export function CommandPalette() {
  const navigate = useNavigate();
  const { user } = useLocalUser();
  const [courses, setCourses] = React.useState<Course[]>([]);
  const coursesLoaded = React.useRef(false);

  const loadCoursesOnOpen = React.useCallback((open: boolean) => {
    if (!open || coursesLoaded.current) return;
    coursesLoaded.current = true;
    void (async () => {
      try {
        const list = (await api.listCourses()) as Course[];
        setCourses(Array.isArray(list) ? list : []);
      } catch {
        coursesLoaded.current = false; // allow a retry on the next open
      }
    })();
  }, []);

  if (!user) return null;

  // STUDENT stays in the /student shell; everyone else uses the /instructor shell.
  const coursePrefix = user.role === 'STUDENT' ? '/student' : '/instructor';

  const groups: CommandPaletteGroup[] = [
    {
      heading: 'Go to',
      items: [
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
      ],
    },
    {
      heading: 'Switch course',
      items: courses.map((c) => ({
        label: c.title ?? 'Untitled course',
        value: `course ${c.title ?? c.id}`,
        icon: <IconLayoutGrid className="size-4" />,
        onSelect: () => navigate(`${coursePrefix}/courses/${c.id}`),
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
      openEventName={AITUTOR_COMMAND_EVENT}
      onOpenChange={loadCoursesOnOpen}
    />
  );
}
