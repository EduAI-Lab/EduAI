import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { BookOpen, MessageSquare } from 'lucide-react';

interface Course {
  id: string;
  code: string;
  name: string;
  description?: string;
}

interface CourseSelectorProps {
  selectedCourseId: string | null;
  onCourseSelect: (courseId: string | null) => void;
}

export function CourseSelector({ selectedCourseId, onCourseSelect }: CourseSelectorProps) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCourses();
  }, []);

  const loadCourses = async () => {
    try {
      const response = await fetch('/api/courses');
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to load courses');
      }

      setCourses(result.courses || []);
    } catch (err) {
      console.error('Failed to load courses:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCourseChange = (courseId: string) => {
    onCourseSelect(courseId === 'none' ? null : courseId);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
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
            <Select value={selectedCourseId || 'none'} onValueChange={handleCourseChange}>
              <SelectTrigger className="mt-2">
                <SelectValue placeholder="Select a course" />
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
              <MessageSquare className="h-4 w-4 text-blue-500" />
              <span className="text-sm">
                Chat will now search through materials from the selected course
              </span>
            </div>
          )}

          {!selectedCourseId && (
            <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <BookOpen className="h-4 w-4 text-yellow-500" />
              <span className="text-sm text-yellow-700">
                Select a course to enable RAG chat with course materials
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}