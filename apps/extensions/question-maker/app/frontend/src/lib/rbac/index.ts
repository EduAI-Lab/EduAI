export type { QmCourseAccess, QmNavItem, QmNavItemKey, QmPlatformRole, QmRoleView, QmUser } from './types';
export { QM_AUTHORIZED_ROLES, canAccessQm } from './roles';
export { resolvePlatformCourseAccess, isAuthoringAccess } from './resolve-course-access';
export {
  canApproveVariant,
  canCreateQuestion,
  canDeleteVariant,
  canEditDraftVariant,
  canEditQuestionMetadata,
  canExportAssessment,
  canLinkCourse,
  canManageAssessment,
  canManageCanvasIntegration,
  canRunAiReview,
  canTriageBugReports,
  canUseVariantWorkflow,
  canViewAssessment,
} from './permissions';
export { getFooterNavForUser, getNavForUser, getRoleViewLabel } from './nav';
