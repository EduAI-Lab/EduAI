import { PageHeading } from '@eduai/ui';
import { useAuth } from '@/contexts/AuthContext';
import { CoursesGrid, type CoursesGridProps } from './CoursesGrid';

type CoursesAdminViewProps = Omit<CoursesGridProps, 'emptyHint' | 'showAddCourse' | 'roleView' | 'currentUserId'>;

export function CoursesAdminView(props: CoursesAdminViewProps) {
  const { user } = useAuth();

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-4 md:py-6 lg:px-6">
      <PageHeading
        heading="Courses"
        subheading="Every course you have access to appears here. Open a course to manage its question bank."
      />
      <CoursesGrid
        {...props}
        showDepartment
        roleView="admin"
        currentUserId={user?.id}
        emptyHint="No courses linked yet. Add a course to start authoring."
      />
    </div>
  );
}
