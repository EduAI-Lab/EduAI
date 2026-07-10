import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
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
import { toast } from 'sonner';
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
      <Card data-testid="course-enrollments-panel">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Loading enrollments…
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card data-testid="course-enrollments-panel">
        <CardContent className="py-10 text-center text-sm text-destructive">
          {error ?? 'Enrollments unavailable.'}
        </CardContent>
      </Card>
    );
  }

  const taCount = data.enrolledStudents.filter((s) => (s.role ?? 'STUDENT') === 'TA').length;

  return (
    <div className="space-y-4" data-testid="course-enrollments-panel">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Enrolled" value={data.enrolledStudents.length} />
        <StatCard label="Teaching assistants" value={taCount} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Course enrollments</CardTitle>
          <CardDescription>
            View enrolled learners and assign TA roles. Adding new students requires EduAI Core user
            sync — use admin sync for imported courses.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.enrolledStudents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No students enrolled yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.enrolledStudents.map((student) => {
                  const enrollmentRole = student.role ?? 'STUDENT';
                  const busy = updatingUserId === student.id;
                  return (
                    <TableRow key={student.id}>
                      <TableCell className="whitespace-normal">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">
                            {student.name || student.id}
                          </span>
                          {student.name && student.name !== student.id ? (
                            <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 font-mono text-xs text-muted-foreground">
                              {student.id}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {student.email || '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{enrollmentRole}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap justify-end gap-2">
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
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
