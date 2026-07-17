import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  PageHeading,
} from '@eduai/ui';
import { useAuth } from '@/contexts/AuthContext';
import { CoursesGrid, type CoursesGridProps } from './CoursesGrid';

type CoursesUnitAdminViewProps = Omit<
  CoursesGridProps,
  'emptyHint' | 'showAddCourse' | 'courses' | 'showDepartment' | 'roleView' | 'currentUserId'
> & {
  courses: CoursesGridProps['courses'];
};

export function CoursesUnitAdminView({ courses, ...gridProps }: CoursesUnitAdminViewProps) {
  const { user } = useAuth();
  const units = user?.authorizedUnits ?? [];
  const [unitFilter, setUnitFilter] = useState<string>('all');
  const unitsLabel = units.length ? units.join(', ') : null;

  // Unit filtering flows through the shared course-list toolbar (next to the
  // search box) so it reads identically to the instructor status filter.
  const unitSelect =
    units.length > 1 ? (
      <>
        <span className="text-sm text-muted-foreground whitespace-nowrap">Filter by unit</span>
        <Select value={unitFilter} onValueChange={setUnitFilter}>
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All units</SelectItem>
            {units.map((unit) => (
              <SelectItem key={unit} value={unit}>
                {unit}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </>
    ) : undefined;

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-4 md:py-6 lg:px-6">
      {units.length === 0 && (
        <div
          role="alert"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200"
        >
          No authorized units are assigned to your account. You can still open courses where you
          are enrolled as an instructor. Contact a platform admin to update your unit access.
        </div>
      )}
      <PageHeading
        heading="Courses"
        subheading={
          unitsLabel
            ? `Courses in ${unitsLabel} that you can author in Question Maker. You can only edit courses in your own units.`
            : 'Courses you can author in Question Maker. You can only edit courses in your own units.'
        }
      />
      <CoursesGrid
        {...gridProps}
        courses={courses}
        showDepartment
        roleView="unit-admin"
        currentUserId={user?.id}
        filters={unitSelect}
        matchesFilter={
          units.length > 1
            ? (course) => unitFilter === 'all' || course.department === unitFilter
            : undefined
        }
        emptyHint={
          unitFilter === 'all'
            ? 'No courses in your unit yet. Link a course from your profile to begin.'
            : `No courses in ${unitFilter}. Try another unit or link a new course.`
        }
      />
    </div>
  );
}
