import { useCallback, useEffect, useState } from 'react';
import { Badge, Button } from '@eduai/ui';
import { toast } from 'sonner';
import api from '~/lib/api';
import type { AdminEnrollmentData, EnrollmentRole } from '~/lib/types';
import { PermissionGate } from '~/components/rbac/PermissionGate';
import { ConfirmDialog } from '~/components/ConfirmDialog';

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
  const [pendingRemoveUser, setPendingRemoveUser] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    try {
      await api.updateEnrollmentRole(courseId, userId, role);
      await refresh();
      toast.success(
        role === 'TA' ? 'Teaching assistant role assigned.' : 'Enrollment updated.',
      );
    } catch {
      toast.error('Could not update enrollment role.');
    } finally {
      setUpdatingUserId(null);
    }
  };

  const removeStudent = async (userId: string) => {
    setUpdatingUserId(userId);
    try {
      await api.removeStudentFromCourse(courseId, userId);
      await refresh();
      toast.success('Student removed from course.');
    } catch {
      toast.error('Could not remove enrollment.');
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
                    {student.name && student.name !== student.id ? (
                      <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 font-mono text-xs text-muted-foreground">
                        {student.id}
                      </span>
                    ) : null}
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
                      onClick={() => setPendingRemoveUser({ id: student.id, name: student.name })}
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
      <ConfirmDialog
        open={pendingRemoveUser !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoveUser(null);
        }}
        title={`Remove ${pendingRemoveUser?.name ?? 'student'}?`}
        description="They will lose access to this course immediately."
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => {
          if (!pendingRemoveUser) return;
          void removeStudent(pendingRemoveUser.id);
          setPendingRemoveUser(null);
        }}
      />
    </div>
  );
}
