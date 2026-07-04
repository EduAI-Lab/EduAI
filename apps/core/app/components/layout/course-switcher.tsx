/**
 * Inline course switcher for the course-detail breadcrumb (issue #764 —
 * QuestionMaker ↔ Core parity). Renders as the trailing breadcrumb crumb: the
 * current course name with a chevron; clicking opens a searchable list of the
 * user's other authorized courses so they can hop courses without going back to
 * the index. The list is fetched lazily on first open.
 *
 * Uses a plain positioned panel (not a Radix Popover) to match the shared
 * Combobox's approach and keep behaviour predictable inside the sticky header.
 */
import * as React from "react";
import { useNavigate } from "react-router";
import { IconChevronDown, IconCheck } from "@tabler/icons-react";

import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  cn,
} from "@eduai/ui";

type SwitcherCourse = { id: string; code: string; name: string };

export function CourseSwitcher({
  currentCourseId,
  currentCourseName,
}: {
  currentCourseId: string;
  currentCourseName: string;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const [courses, setCourses] = React.useState<SwitcherCourse[]>([]);
  const loaded = React.useRef(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // ── Lazy-load the authorized course list on first open ──────────────────────
  React.useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/courses");
        if (!res.ok) return;
        const data = (await res.json()) as { courses?: SwitcherCourse[] };
        if (!cancelled) setCourses(data.courses ?? []);
      } catch {
        loaded.current = false; // allow a retry on the next open
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // ── Close on outside click / Escape ─────────────────────────────────────────
  React.useEffect(() => {
    if (!open) return;
    const onMouse = (e: MouseEvent) => {
      if (
        containerRef.current &&
        e.target instanceof Node &&
        !containerRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouse);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouse);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const select = (id: string) => {
    setOpen(false);
    if (id !== currentCourseId) navigate(`/courses/${id}`);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex max-w-[16rem] items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-normal text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="truncate">{currentCourseName}</span>
        <IconChevronDown className="size-3.5 shrink-0 opacity-50" aria-hidden />
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-1 w-72 rounded-md border bg-popover shadow-md">
          <Command>
            <CommandInput placeholder="Switch course…" autoFocus />
            <CommandList>
              <CommandEmpty>No courses found.</CommandEmpty>
              <CommandGroup>
                {courses.map((course) => (
                  <CommandItem
                    key={course.id}
                    value={`${course.code} ${course.name}`}
                    className="cursor-pointer"
                    onSelect={() => select(course.id)}
                  >
                    <IconCheck
                      className={cn(
                        "mr-2 size-4 shrink-0",
                        course.id === currentCourseId ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="font-medium">{course.code}</span>
                    <span className="truncate text-muted-foreground">{course.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      )}
    </div>
  );
}
