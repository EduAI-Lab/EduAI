/**
 * QuestionMaker's command palette — a thin adapter over the shared `@eduai/ui`
 * CommandPalette (issue #764). Builds navigation, course-tab, and switch-course
 * groups, then hands them to the shared component so the ⌘K palette looks and
 * behaves identically across Core, QuestionMaker, and AI Tutor. Opens on ⌘K or
 * the `qm:open-command` window event (dispatched by the header search button).
 */
import { useNavigate, useLocation } from 'react-router';
import {
  CommandPalette as SharedCommandPalette,
  buildAppSwitcherGroup,
  type CommandPaletteGroup,
} from '@eduai/ui';
import {
  IconBug,
  IconDashboard,
  IconBooks,
  IconLibrary,
  IconSettings,
  IconHelpCircle,
  IconPlus,
  IconClipboardList,
  IconStack2,
  IconFolderOpen,
  IconLayoutGrid,
  IconSchool,
  IconLayoutDashboard,
} from '@tabler/icons-react';
import { useDisplayCourses } from '@/hooks/useDisplayCourses';
import { useAuth } from '@/contexts/AuthContext';
import { CURRENT_APP_ID, getLauncherApps } from '@/lib/apps';
import { getNavForUser, getNavSecondaryForUser } from '@/lib/rbac/nav';
import type { QmNavItemKey } from '@/lib/rbac/types';

const iconClass = 'size-4';

const PALETTE_NAV_ICONS: Record<QmNavItemKey, typeof IconDashboard> = {
  dashboard: IconDashboard,
  courses: IconBooks,
  library: IconLibrary,
  help: IconHelpCircle,
  'bug-reports': IconBug,
  'back-to-eduai': IconBooks,
};

function PaletteNavIcon({ navKey }: { navKey: QmNavItemKey }) {
  const Icon = PALETTE_NAV_ICONS[navKey];
  return <Icon className={iconClass} />;
}

/** Sidebar nav + secondary nav, flattened for the palette (mirrors Core). */
function paletteNavItems(user: Parameters<typeof getNavForUser>[0]) {
  return [...getNavForUser(user), ...getNavSecondaryForUser(user)];
}

export function CommandPalette() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { displayCourses } = useDisplayCourses();
  const { user } = useAuth();

  const courseMatch = pathname.match(/^\/courses\/(\d+)/);
  const courseId = courseMatch ? Number(courseMatch[1]) : null;
  const currentCourse = courseId ? displayCourses.find((c) => c.id === courseId) ?? null : null;

  const groups: CommandPaletteGroup[] = [
    {
      heading: 'Go to',
      items: [
        // Driven by the same lib/rbac/nav the sidebar uses, so role-gated entries
        // (Bug reports) cannot appear in one surface and not the other. Settings
        // is appended here because it lives in the navUser dropdown, not the nav.
        ...paletteNavItems(user).map((item) => ({
          label: item.title,
          icon: <PaletteNavIcon navKey={item.key} />,
          onSelect: () => navigate(item.href),
        })),
        { label: 'Settings', icon: <IconSettings className={iconClass} />, onSelect: () => navigate('/settings') },
      ],
    },
    {
      heading: currentCourse ? currentCourse.code || currentCourse.name : 'This course',
      items: courseId
        ? [
            {
              label: 'New question',
              shortcut: 'C',
              icon: <IconPlus className={iconClass} />,
              onSelect: () => navigate(`/courses/${courseId}/questions/new`),
            },
            { label: 'Questions', icon: <IconStack2 className={iconClass} />, onSelect: () => navigate(`/courses/${courseId}?tab=questions`) },
            { label: 'Assessments', icon: <IconClipboardList className={iconClass} />, onSelect: () => navigate(`/courses/${courseId}?tab=assessments`) },
            { label: 'Topics', icon: <IconFolderOpen className={iconClass} />, onSelect: () => navigate(`/courses/${courseId}?tab=topics`) },
            { label: 'Canvas', icon: <IconSchool className={iconClass} />, onSelect: () => navigate(`/courses/${courseId}?tab=canvas`) },
            { label: 'Overview', icon: <IconLayoutDashboard className={iconClass} />, onSelect: () => navigate(`/courses/${courseId}?tab=overview`) },
          ]
        : [],
    },
    {
      heading: 'Switch course',
      items: displayCourses.slice(0, 8).map((c) => ({
        label: c.code || c.name,
        sublabel: c.code && c.name ? c.name : undefined,
        value: `course ${c.code ?? ''} ${c.name}`,
        icon: <IconLayoutGrid className={iconClass} />,
        onSelect: () => navigate(`/courses/${c.id}`),
      })),
    },
    buildAppSwitcherGroup({
      apps: getLauncherApps(),
      currentAppId: CURRENT_APP_ID,
      role: user?.role,
    }),
  ];

  return <SharedCommandPalette groups={groups} openEventName="qm:open-command" />;
}
