/**
 * Course switcher shown inline in the workspace breadcrumb. Lets you jump between
 * courses without leaving the current tab — the workspace identity + fast travel,
 * GitHub-repo-switcher style. Lands on the same tab in the target course.
 */
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@eduai/ui';
import { IconChevronDown, IconCheck, IconLayoutGrid } from '@tabler/icons-react';
import { useDisplayCourses } from '@/hooks/useDisplayCourses';

const TAB_SAFE = new Set(['overview', 'questions', 'assessments', 'topics', 'canvas']);

interface CourseSwitcherProps {
  courseId: number;
}

export function CourseSwitcher({ courseId }: CourseSwitcherProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { displayCourses } = useDisplayCourses();

  const current = useMemo(
    () => displayCourses.find((c) => c.id === courseId) ?? null,
    [displayCourses, courseId],
  );

  // Carry the active tab across the switch when it's a real workspace tab.
  const tabParam = searchParams.get('tab');
  const targetTab = tabParam && TAB_SAFE.has(tabParam) ? tabParam : 'overview';

  const go = (id: number) => {
    if (id === courseId) return;
    navigate(`/courses/${id}?tab=${targetTab}`);
  };

  const label = current?.code || current?.name || 'Select course';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Switch course"
        className="inline-flex max-w-[14rem] items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <span className="truncate">{label}</span>
        <IconChevronDown className="size-3.5 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Your courses</DropdownMenuLabel>
        <div className="max-h-72 overflow-y-auto">
          {displayCourses.map((c) => {
            const active = c.id === courseId;
            return (
              <DropdownMenuItem
                key={c.id}
                onSelect={() => go(c.id)}
                className="flex items-start gap-2"
              >
                <IconCheck
                  className={`mt-0.5 size-4 shrink-0 ${active ? 'opacity-100 text-primary' : 'opacity-0'}`}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{c.code || c.name}</span>
                  {c.code && c.name && (
                    <span className="truncate text-xs text-muted-foreground">{c.name}</span>
                  )}
                </span>
              </DropdownMenuItem>
            );
          })}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/courses')} className="gap-2">
          <IconLayoutGrid className="size-4" />
          All courses
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
