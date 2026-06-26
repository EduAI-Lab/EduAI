/**
 * Global ⌘K command palette: jump to any page, switch courses, hop between the
 * current course's tabs, and fire common actions (new question, import). Opens on
 * ⌘K / Ctrl+K, or via a `qm:open-command` window event (the header search button
 * dispatches it). Course-aware: surfaces "This course" actions when inside one.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from '@eduai/ui';
import {
  IconDashboard,
  IconBooks,
  IconLibrary,
  IconSettings,
  IconHelpCircle,
  IconPlus,
  IconDownload,
  IconClipboardList,
  IconStack2,
  IconFolderOpen,
  IconLayoutGrid,
  IconSchool,
} from '@tabler/icons-react';
import { useDisplayCourses } from '@/hooks/useDisplayCourses';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { displayCourses } = useDisplayCourses();

  const courseMatch = pathname.match(/^\/courses\/(\d+)/);
  const courseId = courseMatch ? Number(courseMatch[1]) : null;
  const currentCourse = courseId ? displayCourses.find((c) => c.id === courseId) ?? null : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpenEvent = () => setOpen(true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('qm:open-command', onOpenEvent);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('qm:open-command', onOpenEvent);
    };
  }, []);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const go = (to: string) => run(() => navigate(to));

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search or jump to…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Go to">
          <CommandItem onSelect={() => go('/dashboard')}>
            <IconDashboard className="size-4" />
            Dashboard
          </CommandItem>
          <CommandItem onSelect={() => go('/courses')}>
            <IconBooks className="size-4" />
            Courses
          </CommandItem>
          <CommandItem onSelect={() => go('/library')}>
            <IconLibrary className="size-4" />
            Question Library
          </CommandItem>
          <CommandItem onSelect={() => go('/settings')}>
            <IconSettings className="size-4" />
            Settings
          </CommandItem>
          <CommandItem onSelect={() => go('/help')}>
            <IconHelpCircle className="size-4" />
            Help
          </CommandItem>
        </CommandGroup>

        {courseId && (
          <>
            <CommandSeparator />
            <CommandGroup heading={currentCourse ? `${currentCourse.code || currentCourse.name}` : 'This course'}>
              <CommandItem onSelect={() => go(`/courses/${courseId}/questions/new`)}>
                <IconPlus className="size-4" />
                New question
                <CommandShortcut>C</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => go(`/courses/${courseId}?tab=questions`)}>
                <IconStack2 className="size-4" />
                Questions
              </CommandItem>
              <CommandItem onSelect={() => go(`/courses/${courseId}?tab=assessments`)}>
                <IconClipboardList className="size-4" />
                Assessments
              </CommandItem>
              <CommandItem onSelect={() => go(`/courses/${courseId}?tab=topics`)}>
                <IconFolderOpen className="size-4" />
                Topics
              </CommandItem>
              <CommandItem onSelect={() => go(`/courses/${courseId}?tab=canvas`)}>
                <IconSchool className="size-4" />
                Canvas
              </CommandItem>
              <CommandItem onSelect={() => go(`/courses/${courseId}?tab=overview`)}>
                <IconDownload className="size-4 opacity-0" />
                Overview
              </CommandItem>
            </CommandGroup>
          </>
        )}

        {displayCourses.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Switch course">
              {displayCourses.slice(0, 8).map((c) => (
                <CommandItem
                  key={c.id}
                  value={`course ${c.code ?? ''} ${c.name}`}
                  onSelect={() => go(`/courses/${c.id}`)}
                >
                  <IconLayoutGrid className="size-4" />
                  <span className="font-medium">{c.code || c.name}</span>
                  {c.code && c.name && <span className="truncate text-muted-foreground">— {c.name}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
