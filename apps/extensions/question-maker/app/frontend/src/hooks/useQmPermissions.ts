import { useAuth } from '@/contexts/AuthContext';
import {
  resolvePlatformCourseAccess,
  type QmCourseAccess,
  type QmUser,
} from '@/lib/rbac';
import * as permissions from '@/lib/rbac/permissions';

export function useQmPermissions(courseAccess?: QmCourseAccess) {
  const { user } = useAuth();
  const qmUser: QmUser | null = user
    ? { id: user.id, role: user.role, authorizedUnits: user.authorizedUnits }
    : null;
  const access = courseAccess ?? resolvePlatformCourseAccess(qmUser);

  return {
    user: qmUser,
    access,
    canCreateQuestion: permissions.canCreateQuestion(qmUser, access),
    canApproveVariant: permissions.canApproveVariant(qmUser, access),
    canManageAssessment: permissions.canManageAssessment(qmUser, access),
    canViewAssessment: permissions.canViewAssessment(qmUser, access),
    canExportAssessment: permissions.canExportAssessment(qmUser, access),
    canRunAiReview: permissions.canRunAiReview(qmUser, access),
    canUseVariantWorkflow: permissions.canUseVariantWorkflow(qmUser, access),
    canManageCanvas: permissions.canManageCanvasIntegration(qmUser, access),
    canLinkCourse: permissions.canLinkCourse(qmUser),
    canTriageBugReports: permissions.canTriageBugReports(qmUser),
    canEditResource: (resource?: { createdBy?: string | null } | null) =>
      qmUser
        ? permissions.canEditDraftVariant(qmUser, access, resource)
        : false,
    canDeleteResource: (resource?: { createdBy?: string | null } | null) =>
      qmUser
        ? permissions.canDeleteVariant(qmUser, access, resource)
        : false,
  };
}
