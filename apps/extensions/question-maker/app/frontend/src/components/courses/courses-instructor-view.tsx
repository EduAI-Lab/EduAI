import { QmRoleBanner } from '@/components/rbac/QmRoleBanner';
import { useAuth } from '@/contexts/AuthContext';
import { CoursesGrid, type CoursesGridProps } from './CoursesGrid';

type CoursesInstructorViewProps = Omit<CoursesGridProps, 'emptyHint' | 'showAddCourse' | 'roleView' | 'currentUserId'>;

export function CoursesInstructorView(props: CoursesInstructorViewProps) {
  const { user } = useAuth();

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <QmRoleBanner variant="instructor" />
      <div>
        <h1 className="text-2xl font-bold text-foreground">Your courses</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Select a course to manage its question bank and assessments. Shared courses are ones you
          co-teach via enrollment.
        </p>
      </div>
      <CoursesGrid
        {...props}
        roleView="instructor"
        currentUserId={user?.id}
        emptyHint="No courses yet. Add a course from your profile to get started."
      />
    </div>
  );
}
