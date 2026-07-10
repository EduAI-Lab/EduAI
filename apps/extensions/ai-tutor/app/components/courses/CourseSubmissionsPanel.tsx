import { useEffect, useMemo, useState } from 'react';
import { IconPencil } from '@tabler/icons-react';
import {
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@eduai/ui';
import { useAtPermissions } from '~/hooks/useAtPermissions';
import { canGradeSubmissions } from '~/lib/rbac/permissions';
import api from '~/lib/api';
import type { SubmissionRow } from '~/lib/types';

type CourseSubmissionsPanelProps = {
  courseId: number;
};

/**
 * `SubmissionRow` (from `~/lib/types`) mirrors the API response and does not
 * yet expose the Prisma `Submission.score` column. Widen it locally so the
 * grade-override dialog can read/write score without inventing a `feedback`
 * field the API doesn't return (Submission has no plain-text feedback
 * column, only an internal `aiFeedback` JSON blob).
 */
type GradableSubmissionRow = SubmissionRow & { score?: number | null };

type GradeChoice = 'ungraded' | 'correct' | 'incorrect';

export function CourseSubmissionsPanel({ courseId }: CourseSubmissionsPanelProps) {
  const { user, access } = useAtPermissions();
  const canGrade = canGradeSubmissions(user, access);

  const [rows, setRows] = useState<GradableSubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [gradingRow, setGradingRow] = useState<GradableSubmissionRow | null>(null);
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
    const correct = rows.filter((row) => row.isCorrect === true).length;
    const incorrect = rows.filter((row) => row.isCorrect === false).length;
    return { correct, incorrect };
  }, [rows]);

  const openGradeDialog = (row: GradableSubmissionRow) => {
    setGradeChoice(row.isCorrect == null ? 'ungraded' : row.isCorrect ? 'correct' : 'incorrect');
    setGradeScore(row.score != null ? String(row.score) : '');
    setSaveError(null);
    setGradingRow(row);
  };

  const closeGradeDialog = () => {
    if (saving) return;
    setGradingRow(null);
    setSaveError(null);
  };

  const handleSaveGrade = async () => {
    if (!gradingRow) return;

    const payload: { score?: number; isCorrect?: boolean } = {};
    if (gradeChoice !== 'ungraded') payload.isCorrect = gradeChoice === 'correct';
    if (gradeScore.trim() !== '') {
      const parsedScore = Number(gradeScore);
      if (!Number.isNaN(parsedScore)) payload.score = parsedScore;
    }

    const targetId = gradingRow.id;
    const previousRows = rows;
    setSaving(true);
    setSaveError(null);
    // Optimistic update so the table reflects the override immediately.
    setRows((prev) =>
      prev.map((row) => (row.id === targetId ? { ...row, ...payload } : row)),
    );

    try {
      const updated = await api.gradeSubmission(gradingRow.activityId, targetId, payload);
      setRows((prev) =>
        prev.map((row) => (row.id === targetId ? { ...row, ...updated } : row)),
      );
      setGradingRow(null);
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

  return (
    <div className="space-y-4" data-testid="course-submissions-panel">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Submissions" value={rows.length} />
        <StatCard label="Correct" value={stats.correct} />
        <StatCard label="Incorrect" value={stats.incorrect} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Submissions</CardTitle>
          <CardDescription>Recent student answer attempts in this course.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No submissions yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead>Attempt</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>When</TableHead>
                  {canGrade ? <TableHead>Grade</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.userId}</TableCell>
                    <TableCell>{row.activityId}</TableCell>
                    <TableCell>{row.attemptNumber}</TableCell>
                    <TableCell>
                      {row.isCorrect == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Badge variant={row.isCorrect ? 'success' : 'destructive'}>
                          {row.isCorrect ? 'Correct' : 'Incorrect'}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString()}
                    </TableCell>
                    {canGrade ? (
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {row.score != null ? (
                            <span className="text-xs text-muted-foreground">
                              Score {row.score}
                            </span>
                          ) : null}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openGradeDialog(row)}
                          >
                            <IconPencil className="size-3.5" />
                            Grade
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {canGrade ? (
        <Dialog
          open={gradingRow != null}
          onOpenChange={(next) => {
            if (!next) closeGradeDialog();
          }}
        >
          <DialogContent
            className="sm:max-w-md"
            onInteractOutside={(event) => {
              if (saving) event.preventDefault();
            }}
            onEscapeKeyDown={(event) => {
              if (saving) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>Override grade</DialogTitle>
              <DialogDescription>
                {gradingRow
                  ? `Attempt ${gradingRow.attemptNumber} by ${gradingRow.userId} on activity ${gradingRow.activityId}.`
                  : 'Set the result and score for this submission.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
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
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeGradeDialog} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" onClick={handleSaveGrade} disabled={saving}>
                {saving ? 'Saving…' : 'Save grade'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
