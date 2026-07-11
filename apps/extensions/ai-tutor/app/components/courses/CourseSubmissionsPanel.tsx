import { useEffect, useMemo, useState } from 'react';
import {
  IconInbox,
  IconLayoutGrid,
  IconLayoutList,
  IconSearch,
  IconSparkles,
} from '@tabler/icons-react';
import {
  AnswerOption,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatCard,
  cn,
} from '@eduai/ui';
import { useAtPermissions } from '~/hooks/useAtPermissions';
import { canGradeSubmissions } from '~/lib/rbac/permissions';
import api from '~/lib/api';
import type { SubmissionRow } from '~/lib/types';
import { SubmissionCard } from './SubmissionCard';

type CourseSubmissionsPanelProps = {
  courseId: number;
};

type GradeChoice = 'ungraded' | 'correct' | 'incorrect';
type StatusFilter = 'all' | 'needs' | 'correct' | 'incorrect';

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
];

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** Compact "2h ago" style stamp; the full timestamp stays available via `title`. */
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSeconds = Math.round((then - Date.now()) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  if (absSeconds < 45) return 'just now';
  for (const [unit, secondsInUnit] of RELATIVE_UNITS) {
    if (absSeconds >= secondsInUnit) {
      return relativeFormatter.format(Math.round(diffSeconds / secondsInUnit), unit);
    }
  }
  return 'just now';
}

export function CourseSubmissionsPanel({ courseId }: CourseSubmissionsPanelProps) {
  const { user, access } = useAtPermissions();
  const canGrade = canGradeSubmissions(user, access);

  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');

  const [activeRow, setActiveRow] = useState<SubmissionRow | null>(null);
  const [gradeChoice, setGradeChoice] = useState<GradeChoice>('ungraded');
  const [gradeScore, setGradeScore] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .courseSubmissions(courseId, { take: 100 })
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load submissions.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const stats = useMemo(() => {
    let correct = 0;
    let incorrect = 0;
    let needsGrading = 0;
    for (const row of rows) {
      if (row.isCorrect === true) correct += 1;
      else if (row.isCorrect === false) incorrect += 1;
      else needsGrading += 1;
    }
    const graded = correct + incorrect;
    const passRate = graded > 0 ? Math.round((correct / graded) * 100) : null;
    return { correct, incorrect, needsGrading, passRate };
  }, [rows]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter === 'needs' && row.isCorrect != null) return false;
      if (statusFilter === 'correct' && row.isCorrect !== true) return false;
      if (statusFilter === 'incorrect' && row.isCorrect !== false) return false;
      if (query) {
        const haystack = `${row.studentName ?? ''} ${row.userId} ${
          row.activityTitle ?? ''
        } ${row.lessonTitle ?? ''} activity ${row.activityId}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [rows, statusFilter, search]);

  const filterOptions: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'needs', label: 'Needs grading' },
    { value: 'correct', label: 'Correct' },
    { value: 'incorrect', label: 'Incorrect' },
  ];

  const openRowDialog = (row: SubmissionRow) => {
    setGradeChoice(row.isCorrect == null ? 'ungraded' : row.isCorrect ? 'correct' : 'incorrect');
    setGradeScore(row.score != null ? String(row.score) : '');
    setSaveError(null);
    setActiveRow(row);
  };

  const closeDialog = () => {
    if (saving) return;
    setActiveRow(null);
    setSaveError(null);
  };

  const handleSaveGrade = async () => {
    if (!activeRow) return;

    const payload: { score?: number; isCorrect?: boolean } = {};
    if (gradeChoice !== 'ungraded') payload.isCorrect = gradeChoice === 'correct';
    if (gradeScore.trim() !== '') {
      const parsedScore = Number(gradeScore);
      if (!Number.isNaN(parsedScore)) payload.score = parsedScore;
    }

    const targetId = activeRow.id;
    const previousRows = rows;
    setSaving(true);
    setSaveError(null);
    // Optimistic update so the table reflects the override immediately.
    setRows((prev) => prev.map((row) => (row.id === targetId ? { ...row, ...payload } : row)));

    try {
      const updated = await api.gradeSubmission(activeRow.activityId, targetId, payload);
      setRows((prev) => prev.map((row) => (row.id === targetId ? { ...row, ...updated } : row)));
      setActiveRow(null);
    } catch {
      setRows(previousRows);
      setSaveError('Could not save the grade. Try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card data-testid="course-submissions-panel">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Loading submissions…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card data-testid="course-submissions-panel">
        <CardContent className="py-10 text-center text-sm text-destructive">{error}</CardContent>
      </Card>
    );
  }

  const activeFeedback = activeRow?.aiFeedback?.message ?? null;

  const activeResponse = activeRow?.response ?? null;
  const activeHasText =
    typeof activeResponse?.answerText === 'string' && activeResponse.answerText.trim() !== '';
  const activeOptionIndex =
    !activeHasText && typeof activeResponse?.answerOption === 'number'
      ? activeResponse.answerOption
      : null;
  // MCQ verdict tints the option chip; ungraded stays neutral (mirrors SubmissionCard).
  const activeOptionState =
    activeOptionIndex == null
      ? 'default'
      : activeRow?.isCorrect === true
        ? 'correct'
        : activeRow?.isCorrect === false
          ? 'incorrect'
          : 'selected';
  const activeOptionBody =
    activeOptionIndex != null
      ? activeRow?.answerLabel?.trim() || `Option ${activeOptionIndex + 1}`
      : null;
  const activeStudent = activeRow ? activeRow.studentName?.trim() || activeRow.userId : '';
  const activeActivity = activeRow
    ? activeRow.activityTitle?.trim() || `Activity ${activeRow.activityId}`
    : '';

  return (
    <div className="space-y-4" data-testid="course-submissions-panel">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Submissions" value={rows.length} />
        <StatCard
          label="Needs grading"
          value={stats.needsGrading}
          style={
            stats.needsGrading > 0
              ? {
                  background:
                    'linear-gradient(to bottom, oklch(from var(--color-warning-500) l c h / 0.12), var(--card))',
                }
              : undefined
          }
        />
        <StatCard label="Correct" value={stats.correct} />
        <StatCard
          label="Pass rate"
          value={stats.passRate != null ? `${stats.passRate}%` : '—'}
        />
      </div>

      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-1">
            <CardTitle>Submissions</CardTitle>
            <CardDescription>
              {stats.needsGrading > 0
                ? `${stats.needsGrading} attempt${stats.needsGrading === 1 ? '' : 's'} waiting on a grade.`
                : 'Student answer attempts in this course.'}
            </CardDescription>
          </div>
          {rows.length > 0 ? (
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <SegmentedControl
                size="sm"
                ariaLabel="Filter submissions by result"
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value as StatusFilter)}
                options={filterOptions}
                className="flex-wrap"
              />
              <div className="flex items-center gap-3">
                <div className="relative w-full md:max-w-xs">
                  <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search student or activity…"
                    className="pl-9"
                    aria-label="Search submissions"
                  />
                </div>
                {/* Grid ⇄ list (extended) toggle, mirroring QuestionMaker's Questions tab. */}
                <div className="hidden shrink-0 items-center rounded-lg border border-border p-0.5 sm:inline-flex">
                  <button
                    type="button"
                    aria-label="Grid view"
                    aria-pressed={view === 'grid'}
                    onClick={() => setView('grid')}
                    className={cn(
                      'flex size-8 items-center justify-center rounded-md transition-colors',
                      view === 'grid'
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <IconLayoutGrid className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Extended view"
                    aria-pressed={view === 'list'}
                    onClick={() => setView('list')}
                    className={cn(
                      'flex size-8 items-center justify-center rounded-md transition-colors',
                      view === 'list'
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <IconLayoutList className="size-4" />
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <IconInbox className="size-8 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">No submissions yet.</p>
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <IconSearch className="size-8 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">
                No submissions match this filter.
              </p>
            </div>
          ) : (
            <div
              className={cn(
                'grid gap-3',
                view === 'grid' ? 'md:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1',
              )}
            >
              {visibleRows.map((row) => (
                <SubmissionCard
                  key={row.id}
                  row={row}
                  canGrade={canGrade}
                  timeLabel={formatRelativeTime(row.createdAt)}
                  fullTime={new Date(row.createdAt).toLocaleString()}
                  onOpen={openRowDialog}
                  variant={view}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={activeRow != null}
        onOpenChange={(next) => {
          if (!next) closeDialog();
        }}
      >
        <DialogContent
          className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
          onInteractOutside={(event) => {
            if (saving) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (saving) event.preventDefault();
          }}
        >
          {/* Header: identity + result verdict, echoing QuestionMaker's view modal. */}
          <DialogHeader className="space-y-3 border-b border-border px-6 py-5 pr-12 text-left">
            <div className="flex items-center gap-3">
              <Avatar name={activeStudent || 'Student'} size={40} radius={10} />
              <div className="flex min-w-0 flex-1 flex-col">
                <DialogTitle
                  className="truncate text-lg font-semibold leading-snug"
                  title={activeRow?.userId}
                >
                  {activeStudent || 'Submission'}
                </DialogTitle>
                <DialogDescription className="truncate">
                  {activeRow
                    ? `${activeRow.lessonTitle ? `${activeRow.lessonTitle} — ` : ''}${activeActivity} · Attempt ${activeRow.attemptNumber}`
                    : 'Review this submission.'}
                </DialogDescription>
              </div>
              {activeRow ? (
                activeRow.isCorrect == null ? (
                  <Badge variant="warning" className="shrink-0">
                    Needs grading
                  </Badge>
                ) : (
                  <Badge
                    variant={activeRow.isCorrect ? 'success' : 'destructive'}
                    className="shrink-0"
                  >
                    {activeRow.isCorrect ? 'Correct' : 'Incorrect'}
                  </Badge>
                )
              ) : null}
            </div>
          </DialogHeader>

          {/* Body: question + submitted answer + AI note, scrollable. */}
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
            {activeRow?.questionText ? (
              <section>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Question
                </p>
                <div className="border-l-2 border-accent pl-4">
                  <p className="whitespace-pre-wrap break-words font-semibold leading-snug text-foreground">
                    {activeRow.questionText}
                  </p>
                </div>
              </section>
            ) : null}

            <section>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Submitted answer
              </p>
              {activeOptionIndex != null ? (
                <AnswerOption
                  letter={String.fromCharCode(65 + (activeOptionIndex % 26))}
                  state={activeOptionState}
                >
                  {activeOptionBody}
                </AnswerOption>
              ) : activeHasText ? (
                <p className="whitespace-pre-wrap break-words rounded-[var(--radius-lg)] border border-border bg-muted/40 px-4 py-3 text-sm text-foreground">
                  {activeResponse?.answerText}
                </p>
              ) : (
                <p className="rounded-[var(--radius-lg)] border border-dashed border-border bg-muted/20 px-4 py-3 text-sm italic text-muted-foreground">
                  No answer recorded
                </p>
              )}
              {activeFeedback ? (
                <div className="mt-3 flex gap-2 rounded-[var(--radius-lg)] bg-secondary/10 px-3 py-2 text-xs text-muted-foreground">
                  <IconSparkles className="mt-0.5 size-3.5 shrink-0 text-secondary" />
                  <span className="min-w-0 break-words">{activeFeedback}</span>
                </div>
              ) : null}
            </section>

            {canGrade ? (
              <section className="space-y-4 rounded-[var(--radius-lg)] border border-border bg-card p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Override grade
                </p>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground" htmlFor="grade-result">
                    Result
                  </label>
                  <Select
                    value={gradeChoice}
                    onValueChange={(value) => setGradeChoice(value as GradeChoice)}
                  >
                    <SelectTrigger id="grade-result" className="w-full">
                      <SelectValue placeholder="Select a result…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ungraded">Not graded</SelectItem>
                      <SelectItem value="correct">Correct</SelectItem>
                      <SelectItem value="incorrect">Incorrect</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground" htmlFor="grade-score">
                    Score (optional)
                  </label>
                  <Input
                    id="grade-score"
                    type="number"
                    step="any"
                    placeholder="Leave blank to keep unset"
                    value={gradeScore}
                    onChange={(event) => setGradeScore(event.target.value)}
                  />
                </div>

                {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
              </section>
            ) : null}
          </div>

          <DialogFooter className="border-t border-border px-6 py-4">
            {canGrade ? (
              <>
                <Button type="button" variant="outline" onClick={closeDialog} disabled={saving}>
                  Cancel
                </Button>
                <Button type="button" onClick={handleSaveGrade} disabled={saving}>
                  {saving ? 'Saving…' : 'Save grade'}
                </Button>
              </>
            ) : (
              <Button type="button" variant="outline" onClick={closeDialog}>
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
