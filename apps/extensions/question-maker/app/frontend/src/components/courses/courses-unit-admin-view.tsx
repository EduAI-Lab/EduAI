import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  PageHeading,
} from "@eduai/ui";
import { useAuth } from "@/contexts/AuthContext";
import { getDepartmentLabel } from "@/lib/units";
import { CoursesGrid, type CoursesGridProps } from "./CoursesGrid";

type CoursesUnitAdminViewProps = Omit<
  CoursesGridProps,
  "emptyHint" | "courses" | "showDepartment"
> & {
  courses: CoursesGridProps["courses"];
};

export function CoursesUnitAdminView({ courses, ...gridProps }: CoursesUnitAdminViewProps) {
  const { user } = useAuth();
  const units = user?.authorizedUnits ?? [];
  const [unitFilter, setUnitFilter] = useState<string>("all");
  const unitsLabel = units.length ? units.map(getDepartmentLabel).join(", ") : null;

  // Unit filtering flows through the shared course-list toolbar (next to the
  // search box) so it reads identically to the instructor status filter.
  const unitSelect =
    units.length > 1 ? (
      <Select value={unitFilter} onValueChange={setUnitFilter}>
        <SelectTrigger className="w-full sm:w-auto sm:min-w-40" aria-label="Unit">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All units</SelectItem>
          {units.map((unit) => (
            <SelectItem key={unit} value={unit}>
              {getDepartmentLabel(unit)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : undefined;

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-4 md:py-6 lg:px-6">
      {units.length === 0 && (
        <div
          role="alert"
          className="rounded-lg border border-[var(--color-warning-500)] bg-[var(--color-warning-100)] px-4 py-3 text-sm text-[var(--color-warning-700)]"
        >
          No authorized units are assigned to your account. You can still open courses where you are
          enrolled as an instructor. Contact a platform admin to update your unit access.
        </div>
      )}
      <PageHeading
        heading="Courses"
        subheading={
          unitsLabel ? `Courses in ${unitsLabel} that you can author.` : "Courses you can author."
        }
      />
      <CoursesGrid
        {...gridProps}
        courses={courses}
        showDepartment
        filters={unitSelect}
        matchesFilter={
          units.length > 1
            ? (course) => unitFilter === "all" || course.department === unitFilter
            : undefined
        }
        emptyHint={
          unitFilter === "all"
            ? "No courses in your unit yet. Link a course from your profile to begin."
            : `No courses in ${getDepartmentLabel(unitFilter)}. Try another unit or link a new course.`
        }
      />
    </div>
  );
}
