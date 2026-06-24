import type { Course } from '@/types/question';
import type { QmCourseAccess, QmRoleView } from './types';

export function formatCourseAccessLevel(level: QmCourseAccess | Course['accessLevel']): string {
  switch (level) {
    case 'admin':
      return 'Admin access';
    case 'unit':
      return 'Unit scope';
    case 'instructor':
      return 'Instructor access';
    case 'ta':
      return 'TA access';
    default:
      return '';
  }
}

export type CourseRelationship = 'owner' | 'shared';

/** Whether the caller owns the QM course row vs co-access via enrollment. */
export function getCourseRelationship(
  course: Course,
  currentUserId: string | undefined,
): CourseRelationship | null {
  if (!currentUserId || !course.userId) return null;
  return course.userId === currentUserId ? 'owner' : 'shared';
}

export function formatCourseRelationship(relationship: CourseRelationship): string {
  return relationship === 'owner' ? 'Your course' : 'Shared course';
}

export function shouldShowAccessBadge(roleView: QmRoleView | undefined): boolean {
  return roleView === 'admin' || roleView === 'unit-admin';
}

export function shouldShowRelationshipBadge(roleView: QmRoleView | undefined): boolean {
  return roleView === 'instructor';
}
