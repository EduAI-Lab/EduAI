import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@eduai/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@eduai/ui';
import { IconBook, IconMessage } from '@tabler/icons-react';

export interface Course {
  id: string;
  code: string;
  name: string;
  description?: string;
}

export interface CourseSelectorProps {
  courses: Course[];
  selectedCourseId: string | null;
  onCourseSelect: (courseId: string | null) => void;
  isLoading?: boolean;
}

export function CourseSelector({
  courses,
  selectedCourseId,
  onCourseSelect,
  isLoading = false,
}: CourseSelectorProps) {
  const handleCourseChange = (courseId: string) => {
    onCourseSelect(courseId === 'none' ? null : courseId);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconBook className="h-5 w-5" />
          Course Selection
        </CardTitle>
        <CardDescription>
          Select a course to chat with its materials. The AI will search through uploaded course materials to answer your questions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Course</label>
            <Select
              value={selectedCourseId || 'none'}
              onValueChange={handleCourseChange}
              disabled={isLoading}
            >
              <SelectTrigger className="mt-2">
                <SelectValue placeholder={isLoading ? 'Loading courses...' : 'Select a course'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No course selected</SelectItem>
                {courses.map((course) => (
                  <SelectItem key={course.id} value={course.id}>
                    {course.code}: {course.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedCourseId && (
            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <IconMessage className="h-4 w-4 text-blue-500" />
              <span className="text-sm">
                Chat will now search through materials from the selected course
              </span>
            </div>
          )}

          {!selectedCourseId && (
            <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <IconBook className="h-4 w-4 text-yellow-500" />
              <span className="text-sm text-yellow-700">
                Select a course to search its materials in chat
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
