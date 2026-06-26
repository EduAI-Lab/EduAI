import { Badge } from '@eduai/ui';
import {
  formatCourseAccessLevel,
  formatCourseRelationship,
  getCourseRelationship,
  shouldShowAccessBadge,
  shouldShowRelationshipBadge,
} from '@/lib/rbac/course-labels';
import type { QmRoleView } from '@/lib/rbac';
import type { Course } from '@/types/question';

type CourseAccessBadgeProps = {
  course: Course;
  roleView?: QmRoleView;
  currentUserId?: string;
};

export function CourseAccessBadge({ course, roleView, currentUserId }: CourseAccessBadgeProps) {
  const badges: { key: string; label: string; variant: 'default' | 'secondary' | 'outline' }[] = [];

  if (shouldShowAccessBadge(roleView) && course.accessLevel) {
    badges.push({
      key: 'access',
      label: formatCourseAccessLevel(course.accessLevel),
      variant: course.accessLevel === 'admin' ? 'default' : 'secondary',
    });
  }

  if (shouldShowRelationshipBadge(roleView)) {
    const relationship = getCourseRelationship(course, currentUserId);
    if (relationship) {
      badges.push({
        key: 'relationship',
        label: formatCourseRelationship(relationship),
        variant: relationship === 'owner' ? 'default' : 'outline',
      });
    }
  }

  if (badges.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {badges.map((badge) => (
        <Badge key={badge.key} variant={badge.variant} className="text-[10px] font-normal uppercase tracking-wide">
          {badge.label}
        </Badge>
      ))}
    </div>
  );
}
