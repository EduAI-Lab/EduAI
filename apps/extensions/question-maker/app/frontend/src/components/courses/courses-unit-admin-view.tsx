import { QmRoleBanner } from '@/components/rbac/QmRoleBanner';
import { useAuth } from '@/contexts/AuthContext';
import { CoursesGrid, type CoursesGridProps } from './CoursesGrid';

type CoursesUnitAdminViewProps = Omit<CoursesGridProps, 'emptyHint' | 'showAddCourse'>;

export function CoursesUnitAdminView(props: CoursesUnitAdminViewProps) {
  const { user } = useAuth();
  const units = user?.authorizedUnits?.length
    ? user.authorizedUnits.join(', ')
    : 'your assigned units';

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <QmRoleBanner variant="unit-admin" />
      <div>
        <h1 className="text-2xl font-bold text-foreground">Unit courses</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Courses in {units} that you can author in Question Maker. Cross-unit edits are blocked server-side.
        </p>
      </div>
      <CoursesGrid
        {...props}
        showDepartment
        emptyHint="No courses in your unit yet. Link a course from your profile to begin."
      />
    </div>
  );
}
