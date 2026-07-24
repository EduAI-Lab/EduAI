import { PageHeading } from '@eduai/ui';
import { CoursesGrid, type CoursesGridProps } from './CoursesGrid';

type CoursesRoleViewProps = Omit<CoursesGridProps, 'emptyHint' | 'showDepartment'> & {
  role: 'admin' | 'instructor';
};

type RoleConfig = {
  heading: string;
  subheading: string;
  emptyHint: string;
  showDepartment?: boolean;
};

const ROLE_CONFIG: Record<'admin' | 'instructor', RoleConfig> = {
  admin: {
    heading: 'Courses',
    subheading: 'Every course you have access to appears here. Open a course to manage its question bank.',
    emptyHint: 'No courses linked yet. Add a course to start authoring.',
    showDepartment: true,
  },
  instructor: {
    heading: 'Courses',
    subheading:
      'Select a course to manage its question bank and assessments. Shared courses are ones you co-teach via enrollment.',
    emptyHint: 'No courses yet. Add a course from your profile to get started.',
  },
};

/**
 * Shared admin/instructor course selection view, driven by a small role
 * config (heading/subheading/emptyHint/showDepartment). Unit-admin has its
 * own unit-filter behavior and stays on `CoursesUnitAdminView`.
 */
export function CoursesRoleView({ role, ...props }: CoursesRoleViewProps) {
  const config = ROLE_CONFIG[role];

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-4 md:py-6 lg:px-6">
      <PageHeading heading={config.heading} subheading={config.subheading} />
      <CoursesGrid
        {...props}
        showDepartment={config.showDepartment}
        emptyHint={config.emptyHint}
      />
    </div>
  );
}
