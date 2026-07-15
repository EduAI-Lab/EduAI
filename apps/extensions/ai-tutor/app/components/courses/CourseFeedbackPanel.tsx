import { useCallback, useEffect, useRef, useState } from 'react';
import api from '~/lib/api';
import type { ActivityFeedbackRow } from '~/lib/types';

const PAGE_SIZE = 50;

type CourseFeedbackPanelProps = {
  courseId: number;
};

export function CourseFeedbackPanel({ courseId }: CourseFeedbackPanelProps) {
  const [rows, setRows] = useState<ActivityFeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activityIdFilter, setActivityIdFilter] = useState('');
  const [studentIdFilter, setStudentIdFilter] = useState('');
  const [appliedActivityId, setAppliedActivityId] = useState<number | undefined>();
  const [appliedStudentId, setAppliedStudentId] = useState<string | undefined>();
  const [skip, setSkip] = useState(0);
  // Stale-response guard: only the latest in-flight load may write state (#784 review).
  const requestIdRef = useRef(0);

  const loadFeedback = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await api.listCourseFeedback(courseId, {
        activityId: appliedActivityId,
        studentId: appliedStudentId,
        take: PAGE_SIZE,
        skip,
      });
      if (requestId !== requestIdRef.current) return;
      setRows(data);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setError('Could not load feedback.');
      setRows([]);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [courseId, appliedActivityId, appliedStudentId, skip]);

  useEffect(() => {
    void loadFeedback();
  }, [loadFeedback]);

  const applyFilters = () => {
    const nextActivityId = activityIdFilter.trim() ? Number(activityIdFilter.trim()) : undefined;
    if (activityIdFilter.trim() && !Number.isFinite(nextActivityId)) {
      setError('Activity ID must be a number.');
      return;
    }
    setAppliedActivityId(nextActivityId);
    setAppliedStudentId(studentIdFilter.trim() || undefined);
    setSkip(0);
  };

  const clearFilters = () => {
    setActivityIdFilter('');
    setStudentIdFilter('');
    setAppliedActivityId(undefined);
    setAppliedStudentId(undefined);
    setSkip(0);
  };

  const canGoBack = skip > 0;
  const canGoForward = rows.length === PAGE_SIZE;

  if (loading && rows.length === 0 && !error) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        Loading feedback…
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border bg-card p-6" data-testid="course-feedback-panel">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Feedback</h2>
        <p className="text-sm text-muted-foreground">Student activity feedback in this course.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor="feedback-activity-id"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            Activity ID
          </label>
          <input
            id="feedback-activity-id"
            type="text"
            inputMode="numeric"
            value={activityIdFilter}
            onChange={(e) => setActivityIdFilter(e.target.value)}
            placeholder="Any"
            className="input-field w-32"
          />
        </div>
        <div>
          <label
            htmlFor="feedback-student-id"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            Student ID
          </label>
          <input
            id="feedback-student-id"
            type="text"
            value={studentIdFilter}
            onChange={(e) => setStudentIdFilter(e.target.value)}
            placeholder="Any"
            className="input-field w-48"
          />
        </div>
        <button type="button" onClick={applyFilters} className="btn-primary">
          Apply filters
        </button>
        <button type="button" onClick={clearFilters} className="btn-secondary">
          Clear
        </button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading feedback…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No feedback yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-2 py-2 font-medium">Activity</th>
                <th className="px-2 py-2 font-medium">Student</th>
                <th className="px-2 py-2 font-medium">Feedback</th>
                <th className="px-2 py-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60">
                  <td className="px-2 py-2">{row.activityId}</td>
                  <td className="px-2 py-2 font-mono text-xs">{row.userId}</td>
                  <td className="px-2 py-2">
                    {row.note?.trim()
                      ? row.note
                      : row.rating != null
                        ? `Rating: ${row.rating}`
                        : '—'}
                  </td>
                  <td className="px-2 py-2">{new Date(row.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>
          Showing {rows.length === 0 ? 0 : skip + 1}–{skip + rows.length}
          {rows.length === PAGE_SIZE ? '+' : ''}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={!canGoBack || loading}
            onClick={() => setSkip((current) => Math.max(current - PAGE_SIZE, 0))}
          >
            Previous
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!canGoForward || loading}
            onClick={() => setSkip((current) => current + PAGE_SIZE)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

export { PAGE_SIZE };
