import { useMemo } from 'react';
import { useLocalUser } from '~/hooks/useLocalUser';
import * as permissions from '~/lib/rbac/permissions';
import type { AtUser } from '~/lib/rbac/types';

export function useAtPermissions() {
  const { user } = useLocalUser();

  const atUser: AtUser | null = useMemo(() => {
    if (!user) return null;
    return {
      id: user.id,
      role: user.role,
    };
  }, [user]);

  return useMemo(
    () => ({
      user: atUser,
      access: permissions.resolvePlatformCourseAccess(atUser),
      canManageContent: permissions.canManageContent(atUser),
      canCreateCourse: permissions.canCreateCourse(atUser),
      canPublishContent: permissions.canPublishContent(atUser),
      canManageTopics: permissions.canManageTopics(atUser),
      canManageEnrollments: permissions.canManageEnrollments(atUser),
      canAssignTaRole: permissions.canAssignTaRole(atUser),
      canViewCourseSubmissions: permissions.canViewCourseSubmissions(atUser),
      canViewCourseAnalytics: permissions.canViewCourseAnalytics(atUser),
      canViewCourseStudentMetrics: permissions.canViewCourseStudentMetrics(atUser),
      canAccessAdminConsole: permissions.canAccessAdminConsole(atUser),
      canSubmitBugReport: permissions.canSubmitBugReport(atUser),
      usesInstructorShell: permissions.usesInstructorShell(atUser),
      isTaReadOnly: atUser?.role === 'TA',
    }),
    [atUser],
  );
}
