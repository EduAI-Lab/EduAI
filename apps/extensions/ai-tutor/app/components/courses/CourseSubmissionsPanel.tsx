import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@eduai/ui';
import api from '~/lib/api';
import type { SubmissionRow } from '~/lib/types';

type CourseSubmissionsPanelProps = {
  courseId: number;
};

export function CourseSubmissionsPanel({ courseId }: CourseSubmissionsPanelProps) {
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
