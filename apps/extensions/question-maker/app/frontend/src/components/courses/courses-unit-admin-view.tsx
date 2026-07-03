import { useMemo, useState } from 'react';
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

  const filteredCourses = useMemo(() => {
    if (unitFilter === 'all' || units.length <= 1) return courses;
    return courses.filter((course) => course.department === unitFilter);
  }, [courses, unitFilter, units.length]);

  const unitsLabel = units.length ? units.join(', ') : null;

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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <PageHeading
          heading="Courses"
          subheading={
            unitsLabel
              ? `Courses in ${unitsLabel} that you can author in Question Maker. Cross-unit edits are blocked server-side.`
              : 'Courses you can author in Question Maker. Cross-unit edits are blocked server-side.'
          }
        />
        {units.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
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
          </div>
        )}
      </div>
      <CoursesGrid
        {...gridProps}
        courses={filteredCourses}
        showDepartment
        roleView="unit-admin"
        currentUserId={user?.id}
        emptyHint={
          unitFilter === 'all'
            ? 'No courses in your unit yet. Link a course from your profile to begin.'
            : `No courses in ${unitFilter}. Try another unit or link a new course.`
        }
      />
    </div>
  );
}
