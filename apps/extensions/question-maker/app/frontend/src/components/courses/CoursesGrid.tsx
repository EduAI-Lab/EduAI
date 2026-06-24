import { Card, CardContent } from '@eduai/ui';
import { Tooltip } from '@/components/ui/tooltip';
import { CourseAccessBadge } from '@/components/courses/CourseAccessBadge';
import type { QmRoleView } from '@/lib/rbac';
import { GraduationCap, Plus } from 'lucide-react';
import { Course } from '@/types/question';

export type CoursesGridProps = {
  courses: Course[];
  isLoading: boolean;
  onSelectCourse: (course: Course) => void;
  onAddCourse: () => void;
  showAddCourse?: boolean;
  emptyHint?: string;
  showDepartment?: boolean;
  roleView?: QmRoleView;
  currentUserId?: string;
  /** Course card to highlight for guided tour step 1 */
  tourHighlightCourseId?: number | null;
};

export function CoursesGrid({
  courses,
  isLoading,
  onSelectCourse,
  onAddCourse,
  showAddCourse = true,
  emptyHint,
  showDepartment = false,
  roleView,
  currentUserId,
  tourHighlightCourseId = null,
}: CoursesGridProps) {
  const highlightId =
    tourHighlightCourseId ??
    (courses.length > 0 ? courses[0].id : null);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">
        {showAddCourse && (
          <Tooltip content="Add or link a course from the AI service to get started" side="top">
            <Card
              className="border-2 border-dashed border-muted-foreground/30 bg-muted/30 hover:border-primary hover:bg-muted/50 cursor-pointer transition-colors flex min-h-[140px]"
              data-tour-id={courses.length === 0 ? 'course-select' : undefined}
              onClick={onAddCourse}
            >
              <CardContent className="flex flex-col items-center justify-center flex-1 p-6">
                <div className="rounded-full bg-muted p-3 mb-2">
                  <Plus className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">Add new course</p>
              </CardContent>
            </Card>
          </Tooltip>
        )}

        {courses.map((course) => (
          <Tooltip
            key={course.id}
            content={`Open question bank and assessments for ${course.name}`}
            side="top"
          >
            <Card
              className="cursor-pointer transition-shadow hover:shadow-md border bg-card text-card-foreground flex min-h-[140px]"
              data-tour-id={course.id === highlightId ? 'course-select' : undefined}
              data-course-id={course.id}
              onClick={() => onSelectCourse(course)}
            >
              <CardContent className="flex flex-col flex-1 p-6 justify-center">
                <div className="flex items-center gap-2 min-w-0">
                  <GraduationCap className="h-5 w-5 text-primary-text shrink-0" />
                  <span className="font-semibold truncate">{course.name}</span>
                </div>
                {course.code && (
                  <p className="text-sm text-muted-foreground mt-1">{course.code}</p>
                )}
                {showDepartment && course.department && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Unit: <span className="font-medium text-foreground">{course.department}</span>
                  </p>
                )}
                <CourseAccessBadge
                  course={course}
                  roleView={roleView}
                  currentUserId={currentUserId}
                />
                <p className="text-xs text-muted-foreground/80 mt-2">Click to open</p>
              </CardContent>
            </Card>
          </Tooltip>
        ))}
      </div>

      {!isLoading && courses.length === 0 && emptyHint && (
        <p className="text-sm text-muted-foreground mt-4">{emptyHint}</p>
      )}
    </>
  );
}
