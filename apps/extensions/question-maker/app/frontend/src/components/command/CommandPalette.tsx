/**
 * QuestionMaker's command palette — a thin adapter over the shared `@eduai/ui`
 * CommandPalette (issue #764). Builds navigation, course-tab, and switch-course
 * groups, then hands them to the shared component so the ⌘K palette looks and
 * behaves identically across Core, QuestionMaker, and AI Tutor. Opens on ⌘K or
 * the `qm:open-command` window event (dispatched by the header search button).
 */
import { useNavigate, useLocation } from 'react-router';
import { CommandPalette as SharedCommandPalette, type CommandPaletteGroup } from '@eduai/ui';
import {
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

const iconClass = 'size-4';

export function CommandPalette() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { displayCourses } = useDisplayCourses();

  const courseMatch = pathname.match(/^\/courses\/(\d+)/);
  const courseId = courseMatch ? Number(courseMatch[1]) : null;
  const currentCourse = courseId ? displayCourses.find((c) => c.id === courseId) ?? null : null;

  const groups: CommandPaletteGroup[] = [
    {
      heading: 'Go to',
      items: [
        { label: 'Dashboard', icon: <IconDashboard className={iconClass} />, onSelect: () => navigate('/dashboard') },
        { label: 'Courses', icon: <IconBooks className={iconClass} />, onSelect: () => navigate('/courses') },
        { label: 'Question Library', icon: <IconLibrary className={iconClass} />, onSelect: () => navigate('/library') },
        { label: 'Settings', icon: <IconSettings className={iconClass} />, onSelect: () => navigate('/settings') },
        { label: 'Help', icon: <IconHelpCircle className={iconClass} />, onSelect: () => navigate('/help') },
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
  ];

  return <SharedCommandPalette groups={groups} openEventName="qm:open-command" />;
}
