import { useAuth } from '@/contexts/AuthContext';
import {
  resolvePlatformCourseAccess,
  type QmCourseAccess,
  type QmUser,
} from '@/lib/rbac';
import * as permissions from '@/lib/rbac/permissions';
import { useCourseAccess } from './useCourseAccess';

/**
 * Resolves permissions for a specific course when `courseAccess` is passed.
 * Omit or pass `undefined` to use platform-role defaults (nav, course picker).
 * Pass `null` when the caller lacks access to the selected course.
 */
export function useQmPermissions(courseAccess?: QmCourseAccess) {
  const { user } = useAuth();
  const qmUser: QmUser | null = user
    ? { id: user.id, role: user.role, authorizedUnits: user.authorizedUnits }
    : null;

  const access =
    courseAccess !== undefined
      ? courseAccess
      : resolvePlatformCourseAccess(qmUser);

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

/** Course-scoped permissions — hides write actions while loading or when access is denied. */
export function useQmPermissionsForCourse(courseId: number | null | undefined) {
  const { access, isLoading } = useCourseAccess(courseId);

  const effectiveAccess: QmCourseAccess | undefined =
    courseId == null ? undefined : isLoading ? null : access;

  const perms = useQmPermissions(effectiveAccess);

  return {
    ...perms,
    courseAccess: access,
    accessLoading: isLoading,
    hasCourseAccess: courseId != null && !isLoading && access != null,
  };
}
