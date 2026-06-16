import { useEffect, useState } from 'react';
import { Badge } from '@eduai/ui';
import api from '~/lib/api';
import type { ActivityAnalyticsRow } from '~/lib/types';

type CourseAnalyticsPanelProps = {
  courseId: number;
};

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

  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        Loading analytics…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-destructive">{error}</div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border bg-card p-6" data-testid="course-analytics-panel">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Activity analytics</h2>
        <p className="text-sm text-muted-foreground">
          Aggregate ratings and difficulty signals per activity.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No analytics recorded yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.activityId} className="rounded-lg border px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">
                  {row.activity?.title ?? `Activity ${row.activityId}`}
                </span>
                {row.difficultyScore ? (
                  <Badge variant="outline">{row.difficultyScore}</Badge>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Avg rating: {row.averageRating?.toFixed(1) ?? '—'} · Feedback count:{' '}
                {row.feedbackCount ?? 0}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
