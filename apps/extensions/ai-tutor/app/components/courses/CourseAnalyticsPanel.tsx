import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DonutChart,
  MeterBar,
  PanelCard,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type DonutSegment,
} from '@eduai/ui';
import api from '~/lib/api';
import type { ActivityAnalyticsRow, StudentMetricRow } from '~/lib/types';

type CourseAnalyticsPanelProps = {
  courseId: number;
};

// Cycled onto each distinct `difficultyScore` label in appearance order.
// Generic on purpose — the field is a free-text string, not a fixed enum, so
// this can't assume an Easy/Medium/Hard domain.
const DIFFICULTY_PALETTE = [
  'var(--color-success-500)',
  'var(--color-warning-500)',
  'var(--color-error-500)',
  'var(--primary)',
  'var(--secondary)',
];

export function CourseAnalyticsPanel({ courseId }: CourseAnalyticsPanelProps) {
  const [rows, setRows] = useState<ActivityAnalyticsRow[]>([]);
  const [metrics, setMetrics] = useState<StudentMetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([api.courseAnalytics(courseId), api.courseStudentMetrics(courseId)])
      .then(([analytics, studentMetrics]) => {
        if (cancelled) return;
        setRows(analytics);
        setMetrics(studentMetrics);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load analytics.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const stats = useMemo(() => {
    const rated = rows.filter((row) => typeof row.averageRating === 'number');
    const avgRating =
      rated.length > 0
        ? rated.reduce((sum, row) => sum + (row.averageRating ?? 0), 0) / rated.length
        : null;
    const totalFeedback = rows.reduce((sum, row) => sum + (row.feedbackCount ?? 0), 0);
    return { avgRating, totalFeedback };
  }, [rows]);

  const difficultyMix = useMemo<DonutSegment[]>(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (!row.difficultyScore) continue;
      counts.set(row.difficultyScore, (counts.get(row.difficultyScore) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([label, value], index) => ({
      label,
      value,
      color: DIFFICULTY_PALETTE[index % DIFFICULTY_PALETTE.length],
    }));
  }, [rows]);

  const totals = useMemo(
    () =>
      metrics.reduce(
        (acc, row) => ({
          submissions: acc.submissions + row.submissionCount,
          correct: acc.correct + row.correctSubmissionCount,
          incorrect: acc.incorrect + row.incorrectSubmissionCount,
          helpRequests: acc.helpRequests + row.helpRequestCount,
        }),
        { submissions: 0, correct: 0, incorrect: 0, helpRequests: 0 },
      ),
    [metrics],
  );

  const graded = totals.correct + totals.incorrect;
  const accuracy = graded > 0 ? Math.round((totals.correct / graded) * 100) : null;

  if (loading) {
    return (
      <Card data-testid="course-analytics-panel">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Loading analytics…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card data-testid="course-analytics-panel">
        <CardContent className="py-10 text-center text-sm text-destructive">{error}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="course-analytics-panel">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <StatCard label="Students" value={metrics.length} />
        <StatCard label="Submissions" value={totals.submissions} />
        <StatCard label="Accuracy" value={accuracy != null ? `${accuracy}%` : '—'} />
        <StatCard label="Avg rating" value={stats.avgRating != null ? stats.avgRating.toFixed(1) : '—'} />
        <StatCard label="Total feedback" value={stats.totalFeedback} />
        <StatCard label="Help requests" value={totals.helpRequests} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {difficultyMix.length > 0 && (
          <PanelCard title="Difficulty mix">
            <DonutChart data={difficultyMix} centerValue={rows.length} centerLabel="Activities" />
          </PanelCard>
        )}

        <PanelCard title="Overall accuracy">
          {graded > 0 ? (
            <div className="space-y-4">
              <MeterBar
                label="Correct submissions"
                value={totals.correct}
                total={graded}
                color="var(--color-success-500)"
              />
              <dl className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Correct</dt>
                  <dd className="font-medium text-foreground">{totals.correct}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Incorrect</dt>
                  <dd className="font-medium text-foreground">{totals.incorrect}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Activities</dt>
                  <dd className="font-medium text-foreground">{rows.length}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No graded submissions yet.</p>
          )}
        </PanelCard>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activity analytics</CardTitle>
          <CardDescription>Aggregate ratings and difficulty signals per activity.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No analytics recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Activity</TableHead>
                  <TableHead>Difficulty</TableHead>
                  <TableHead>Avg rating</TableHead>
                  <TableHead>Feedback count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.activityId}>
                    <TableCell className="whitespace-normal font-medium text-foreground">
                      {row.activity?.title ?? `Activity ${row.activityId}`}
                    </TableCell>
                    <TableCell>
                      {row.difficultyScore ? (
                        <Badge variant="outline">{row.difficultyScore}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>{row.averageRating?.toFixed(1) ?? '—'}</TableCell>
                    <TableCell>{row.feedbackCount ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Student metrics</CardTitle>
          <CardDescription>Per-student activity performance.</CardDescription>
        </CardHeader>
        <CardContent>
          {metrics.length === 0 ? (
            <p className="text-sm text-muted-foreground">No metrics recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Submissions</TableHead>
                  <TableHead>Correct</TableHead>
                  <TableHead>Incorrect</TableHead>
                  <TableHead>Help requests</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.map((row) => (
                  <TableRow key={row.userId}>
                    <TableCell className="font-mono text-xs">{row.userId}</TableCell>
                    <TableCell>{row.submissionCount}</TableCell>
                    <TableCell>{row.correctSubmissionCount}</TableCell>
                    <TableCell>{row.incorrectSubmissionCount}</TableCell>
                    <TableCell>{row.helpRequestCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
