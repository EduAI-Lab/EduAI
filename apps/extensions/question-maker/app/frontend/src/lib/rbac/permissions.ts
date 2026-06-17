import type { OwnableResource, QmCourseAccess, QmUser } from './types';
import { isAuthoringAccess, resolvePlatformCourseAccess } from './resolve-course-access';

function accessFor(user: QmUser | null | undefined, courseAccess?: QmCourseAccess): QmCourseAccess {
  if (courseAccess !== undefined) return courseAccess;
  return resolvePlatformCourseAccess(user);
}

function isOwner(user: QmUser, resource?: OwnableResource | null): boolean {
  if (!resource?.createdBy) return false;
  return resource.createdBy === user.id;
}

// §16 — Question authoring
export function canCreateQuestion(
  user: QmUser | null | undefined,
  courseAccess?: QmCourseAccess,
): boolean {
  const access = accessFor(user, courseAccess);
  return isAuthoringAccess(access) || access === 'ta';
}

export function canEditQuestionMetadata(
  user: QmUser,
  courseAccess: QmCourseAccess | undefined,
  resource?: OwnableResource | null,
): boolean {
  const access = accessFor(user, courseAccess);
  if (access === 'admin' || access === 'unit' || access === 'instructor') return true;
  if (access === 'ta') return isOwner(user, resource);
  return false;
}

export function canApproveVariant(
  user: QmUser | null | undefined,
  courseAccess?: QmCourseAccess,
): boolean {
  const access = accessFor(user, courseAccess);
  return access === 'admin' || access === 'unit' || access === 'instructor';
}

export function canEditDraftVariant(
  user: QmUser,
  courseAccess: QmCourseAccess | undefined,
  resource?: OwnableResource | null,
): boolean {
  return canEditQuestionMetadata(user, courseAccess, resource);
}

export function canDeleteVariant(
  user: QmUser,
  courseAccess: QmCourseAccess | undefined,
  resource?: OwnableResource | null,
): boolean {
  return canEditDraftVariant(user, courseAccess, resource);
}

// §17 — Assessments (writes instructor+; view includes TA)
export function canViewAssessment(
  user: QmUser | null | undefined,
  courseAccess?: QmCourseAccess,
): boolean {
  const access = accessFor(user, courseAccess);
  return isAuthoringAccess(access) || access === 'ta';
}

export function canManageAssessment(
  user: QmUser | null | undefined,
  courseAccess?: QmCourseAccess,
): boolean {
  const access = accessFor(user, courseAccess);
  return isAuthoringAccess(access);
}

export function canExportAssessment(
  user: QmUser | null | undefined,
  courseAccess?: QmCourseAccess,
): boolean {
  return canManageAssessment(user, courseAccess);
}

export function canRunAiReview(
  user: QmUser | null | undefined,
  courseAccess?: QmCourseAccess,
): boolean {
  return canManageAssessment(user, courseAccess);
}

export function canUseVariantWorkflow(
  user: QmUser | null | undefined,
  courseAccess?: QmCourseAccess,
): boolean {
  return canManageAssessment(user, courseAccess);
}

// §18 — Canvas (instructor+ for course ops; own credentials)
export function canManageCanvasIntegration(
  user: QmUser | null | undefined,
  courseAccess?: QmCourseAccess,
): boolean {
  const access = accessFor(user, courseAccess);
  return isAuthoringAccess(access);
}

// Course onboarding
export function canLinkCourse(user: QmUser | null | undefined): boolean {
  if (!user?.role) return false;
  return user.role === 'ADMIN' || user.role === 'UNIT_ADMIN' || user.role === 'INSTRUCTOR';
}
