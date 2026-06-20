import { useEffect, useState } from 'react';
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

  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        Loading student metrics…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-destructive">{error}</div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border bg-card p-6" data-testid="course-metrics-panel">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Student metrics</h2>
        <p className="text-sm text-muted-foreground">Per-student activity performance.</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No metrics recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-2 py-2 font-medium">Student</th>
                <th className="px-2 py-2 font-medium">Submissions</th>
                <th className="px-2 py-2 font-medium">Correct</th>
                <th className="px-2 py-2 font-medium">Incorrect</th>
                <th className="px-2 py-2 font-medium">Help requests</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.userId} className="border-b border-border/60">
                  <td className="px-2 py-2 font-mono text-xs">{row.userId}</td>
                  <td className="px-2 py-2">{row.submissionCount}</td>
                  <td className="px-2 py-2">{row.correctSubmissionCount}</td>
                  <td className="px-2 py-2">{row.incorrectSubmissionCount}</td>
                  <td className="px-2 py-2">{row.helpRequestCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
