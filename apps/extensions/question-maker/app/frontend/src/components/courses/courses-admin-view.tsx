import { QmRoleBanner } from '@/components/rbac/QmRoleBanner';
import { CoursesGrid, type CoursesGridProps } from './CoursesGrid';

type CoursesAdminViewProps = Omit<CoursesGridProps, 'emptyHint' | 'showAddCourse'>;

export function CoursesAdminView(props: CoursesAdminViewProps) {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <QmRoleBanner variant="admin" />
      <div>
        <h1 className="text-2xl font-bold text-foreground">All courses</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Platform-wide access — open any linked course or add a new one for testing.
        </p>
      </div>
      <CoursesGrid
        {...props}
        showAddCourse
        emptyHint="No courses linked yet. Add a course to start authoring."
      />
    </div>
  );
}
