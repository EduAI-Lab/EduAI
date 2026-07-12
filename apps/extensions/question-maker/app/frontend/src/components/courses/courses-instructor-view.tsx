import { PageHeading } from '@eduai/ui';
import { useAuth } from '@/contexts/AuthContext';
import { CoursesGrid, type CoursesGridProps } from './CoursesGrid';

type CoursesInstructorViewProps = Omit<CoursesGridProps, 'emptyHint' | 'showAddCourse' | 'roleView' | 'currentUserId'>;

export function CoursesInstructorView(props: CoursesInstructorViewProps) {
  const { user } = useAuth();

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-4 md:py-6 lg:px-6">
      <PageHeading
        heading="Courses"
        subheading="Select a course to manage its question bank and assessments. Shared courses are ones you co-teach via enrollment."
      />
      <CoursesGrid
        {...props}
        roleView="instructor"
        currentUserId={user?.id}
        emptyHint="No courses yet. Add a course from your profile to get started."
      />
    </div>
  );
}
