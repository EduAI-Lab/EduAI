import { useCallback, useEffect, useState } from 'react';
import { Badge, Button } from '@eduai/ui';
import api from '~/lib/api';
import type { AdminEnrollmentData, EnrollmentRole } from '~/lib/types';
import { PermissionGate } from '~/components/rbac/PermissionGate';

type CourseEnrollmentsPanelProps = {
  courseId: number;
  canManage: boolean;
  canAssignTa: boolean;
};

export function CourseEnrollmentsPanel({
  courseId,
  canManage,
  canAssignTa,
}: CourseEnrollmentsPanelProps) {
  const [data, setData] = useState<AdminEnrollmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.getAdminCourseEnrollments(courseId);
      setData(next);
    } catch {
      setError('Could not load enrollments.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateRole = async (userId: string, role: EnrollmentRole) => {
    setUpdatingUserId(userId);
    setError(null);
    setMessage(null);
    try {
      await api.updateEnrollmentRole(courseId, userId, role);
      await refresh();
      setMessage(role === 'TA' ? 'Teaching assistant role assigned.' : 'Enrollment updated.');
    } catch {
      setError('Could not update enrollment role.');
    } finally {
      setUpdatingUserId(null);
    }
  };

  const removeStudent = async (userId: string) => {
    setUpdatingUserId(userId);
    setError(null);
    setMessage(null);
    try {
      await api.removeStudentFromCourse(courseId, userId);
      await refresh();
      setMessage('Student removed from course.');
    } catch {
      setError('Could not remove enrollment.');
    } finally {
      setUpdatingUserId(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        Loading enrollments…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-destructive">
        {error ?? 'Enrollments unavailable.'}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border bg-card p-6" data-testid="course-enrollments-panel">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">Course enrollments</h2>
        <p className="text-sm text-muted-foreground">
          View enrolled learners and assign TA roles. Adding new students requires EduAI Core user
          sync — use admin sync for imported courses.
        </p>
      </div>

      {(error || message) && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            error
              ? 'border-destructive/30 bg-destructive/10 text-destructive'
              : 'border-accent/30 bg-accent/10 text-accent-foreground'
          }`}
        >
          {error ?? message}
        </div>
      )}

      {data.enrolledStudents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No students enrolled yet.</p>
      ) : (
        <div className="space-y-3">
          {data.enrolledStudents.map((student) => {
            const enrollmentRole = student.role ?? 'STUDENT';
            const busy = updatingUserId === student.id;
            return (
              <div
                key={student.id}
                className="flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{student.name || student.id}</span>
                    <Badge variant="outline">{enrollmentRole}</Badge>
                  </div>
                  {student.email ? (
                    <p className="text-sm text-muted-foreground">{student.email}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <PermissionGate allow={canManage && canAssignTa && enrollmentRole === 'STUDENT'}>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void updateRole(student.id, 'TA')}
                    >
                      Make TA
                    </Button>
                  </PermissionGate>
                  <PermissionGate allow={canManage && canAssignTa && enrollmentRole === 'TA'}>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void updateRole(student.id, 'STUDENT')}
                    >
                      Remove TA
                    </Button>
                  </PermissionGate>
                  <PermissionGate allow={canManage}>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => void removeStudent(student.id)}
                    >
                      Remove
                    </Button>
                  </PermissionGate>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
