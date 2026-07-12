import { useEffect, useState } from 'react';
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

  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        Loading submissions…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-destructive">{error}</div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border bg-card p-6" data-testid="course-submissions-panel">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Submissions</h2>
        <p className="text-sm text-muted-foreground">
          Recent student answer attempts in this course.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No submissions yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-2 py-2 font-medium">Student</th>
                <th className="px-2 py-2 font-medium">Activity</th>
                <th className="px-2 py-2 font-medium">Attempt</th>
                <th className="px-2 py-2 font-medium">Result</th>
                <th className="px-2 py-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60">
                  <td className="px-2 py-2 font-mono text-xs">{row.userId}</td>
                  <td className="px-2 py-2">{row.activityId}</td>
                  <td className="px-2 py-2">{row.attemptNumber}</td>
                  <td className="px-2 py-2">
                    {row.isCorrect == null ? '—' : row.isCorrect ? 'Correct' : 'Incorrect'}
                  </td>
                  <td className="px-2 py-2">{new Date(row.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
