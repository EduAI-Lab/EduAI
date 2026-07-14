/**
 * @file Admin/unit-admin oversight table for AI tutoring interactions.
 *
 * Responsibility: Lists recent `AiInteractionTrace` rows (mode, model, status,
 *   latency, course, student, when) so ADMIN and UNIT_ADMIN can audit how the
 *   AI tutor is behaving without digging through logs. Read-only.
 * Data: seeded by the admin route loader (`initialTraces`), then refetched
 *   client-side via `api.adminAiTraces` whenever the course or row-limit
 *   filter changes — mirrors the loader-seeds-then-local-state pattern used
 *   by `BugReportsTab`.
 * Used by: `app/routes/admin.tsx` as the "AI oversight" tab.
 * Gotchas:
 *   - Every field on `AiTraceRow` (`~/lib/api`) is optional except `id` — the
 *     trace shape is populated best-effort by the AI loop and older rows may
 *     predate a given field. Render everything defensively.
 *   - The course filter's option list is captured once from the initial,
 *     unfiltered load so it doesn't shrink to "whatever the current filter
 *     returned" after a courseId-scoped refetch.
 */

import { useState } from 'react';
import {
  Alert,
  AlertDescription,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@eduai/ui';
import { IconAlertCircle } from '@tabler/icons-react';
import api, { type AiTraceRow } from '~/lib/api';

const LIMIT_OPTIONS = ['25', '50', '100', '200'] as const;
const DEFAULT_LIMIT = '50';
const ERROR_STATUS_PATTERN = /error|fail/i;

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffMins = Math.floor((Date.now() - then) / 60_000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Sentence-case a raw mode/status value like "SOCRATIC" or "in_progress" for display. */
function formatLabel(value: string): string {
  const words = value.toLowerCase().replace(/_/g, ' ').trim();
  return words.length ? words[0].toUpperCase() + words.slice(1) : words;
}

function outcomeBadgeVariant(outcome?: string | null): 'destructive' | 'outline' {
  if (outcome && ERROR_STATUS_PATTERN.test(outcome)) return 'destructive';
  return 'outline';
}

type CourseOption = { id: string; label: string };

function uniqueCourseOptions(rows: AiTraceRow[]): CourseOption[] {
  const seen = new Map<string, string>();
  for (const row of rows) {
    if (row.courseId == null) continue;
    const id = String(row.courseId);
    if (!seen.has(id)) seen.set(id, row.courseTitle ?? `Course ${id}`);
  }
  return Array.from(seen, ([id, label]) => ({ id, label })).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}

export function AiOversightPanel({ initialTraces }: { initialTraces: AiTraceRow[] }) {
  const [traces, setTraces] = useState<AiTraceRow[]>(initialTraces);
  const [courseFilter, setCourseFilter] = useState('all');
  const [limit, setLimit] = useState<string>(DEFAULT_LIMIT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Captured once from the unfiltered initial load so the dropdown keeps
  // every course seen, even after a course-scoped refetch narrows `traces`.
  const [courseOptions] = useState(() => uniqueCourseOptions(initialTraces));

  const refetch = async (nextCourseFilter: string, nextLimit: string) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.adminAiTraces({
        courseId: nextCourseFilter === 'all' ? undefined : nextCourseFilter,
        limit: Number(nextLimit),
      });
      setTraces(rows ?? []);
    } catch {
      setError('Could not load AI oversight data. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const onCourseFilterChange = (value: string) => {
    setCourseFilter(value);
    void refetch(value, limit);
  };

  const onLimitChange = (value: string) => {
    setLimit(value);
    void refetch(courseFilter, value);
  };

  return (
    <Card className="animate-fade-up delay-150">
      <CardHeader>
        <CardTitle>AI oversight</CardTitle>
        <CardDescription>Review recent AI tutoring interactions across your courses.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <IconAlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select value={courseFilter} onValueChange={onCourseFilterChange}>
            <SelectTrigger className="sm:w-56" aria-label="Filter by course">
              <SelectValue placeholder="All courses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All courses</SelectItem>
              {courseOptions.map((course) => (
                <SelectItem key={course.id} value={course.id}>
                  {course.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={limit} onValueChange={onLimitChange}>
            <SelectTrigger className="sm:w-40" aria-label="Rows to show">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIMIT_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  Show {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Course</TableHead>
              <TableHead>Activity</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Iterations</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, index) => (
                // eslint-disable-next-line react/no-array-index-key
                <TableRow key={`loading-${index}`}>
                  {Array.from({ length: 8 }).map((__, cellIndex) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <TableCell key={`loading-cell-${cellIndex}`}>
                      <Skeleton className="h-4 w-full max-w-32" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : traces.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                  No AI tutoring interactions yet.
                </TableCell>
              </TableRow>
            ) : (
              traces.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium text-foreground">
                    {row.user?.name ?? 'Unknown student'}
                  </TableCell>
                  <TableCell>
                    {row.courseTitle ?? (row.courseId != null ? `Course ${row.courseId}` : '—')}
                  </TableCell>
                  <TableCell>{row.activity?.title ?? '—'}</TableCell>
                  <TableCell>
                    {row.mode ? <Badge variant="outline">{formatLabel(row.mode)}</Badge> : '—'}
                  </TableCell>
                  <TableCell className="text-sm">{row.tutorModelId ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{row.iterationCount ?? '—'}</TableCell>
                  <TableCell>
                    {row.finalOutcome ? (
                      <Badge variant={outcomeBadgeVariant(row.finalOutcome)}>
                        {formatLabel(row.finalOutcome)}
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.createdAt ? relativeTime(row.createdAt) : '—'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default AiOversightPanel;
