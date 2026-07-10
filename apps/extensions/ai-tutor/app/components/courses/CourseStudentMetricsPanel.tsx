import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  MeterBar,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@eduai/ui';
import api from '~/lib/api';
import type { StudentMetricRow } from '~/lib/types';

type CourseStudentMetricsPanelProps = {
  courseId: number;
};

export function CourseStudentMetricsPanel({ courseId }: CourseStudentMetricsPanelProps) {
  const [rows, setRows] = useState<StudentMetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .courseStudentMetrics(courseId)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load student metrics.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          submissions: acc.submissions + row.submissionCount,
          correct: acc.correct + row.correctSubmissionCount,
          incorrect: acc.incorrect + row.incorrectSubmissionCount,
          helpRequests: acc.helpRequests + row.helpRequestCount,
        }),
        { submissions: 0, correct: 0, incorrect: 0, helpRequests: 0 },
      ),
    [rows],
  );

  if (loading) {
    return (
      <Card data-testid="course-metrics-panel">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Loading student metrics…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card data-testid="course-metrics-panel">
        <CardContent className="py-10 text-center text-sm text-destructive">{error}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="course-metrics-panel">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Students" value={rows.length} />
        <StatCard label="Submissions" value={totals.submissions} />
        <StatCard label="Correct" value={totals.correct} />
        <StatCard label="Help requests" value={totals.helpRequests} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Student metrics</CardTitle>
          <CardDescription>Per-student activity performance.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No metrics recorded yet.</p>
          ) : (
            <>
              {totals.correct + totals.incorrect > 0 && (
                <div className="max-w-sm">
                  <MeterBar
                    label="Overall accuracy"
                    value={totals.correct}
                    total={totals.correct + totals.incorrect}
                    color="var(--color-success-500)"
                  />
                </div>
              )}
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
                  {rows.map((row) => (
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
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
