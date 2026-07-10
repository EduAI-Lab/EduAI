import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DonutChart,
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
import type { ActivityAnalyticsRow } from '~/lib/types';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .courseAnalytics(courseId)
      .then((data) => {
        if (!cancelled) setRows(data);
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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Activities tracked" value={rows.length} />
        <StatCard label="Avg rating" value={stats.avgRating != null ? stats.avgRating.toFixed(1) : '—'} />
        <StatCard label="Total feedback" value={stats.totalFeedback} />
      </div>

      {difficultyMix.length > 0 && (
        <PanelCard title="Difficulty mix">
          <DonutChart data={difficultyMix} centerValue={rows.length} centerLabel="Activities" />
        </PanelCard>
      )}

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
    </div>
  );
}
