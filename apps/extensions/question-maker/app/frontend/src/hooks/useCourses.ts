/**
 * Hook for fetching and mutating the authenticated user's courses with loading/error tracking.
 * Exposes CRUD helpers that keep local state in sync with courseService responses.
 */
import { useState, useEffect, useCallback } from 'react';
import { Course, CourseCreate } from '../types/question';
import { courseService } from '../services/courseService';

export const useCourses = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCourses = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await courseService.getCourses();
      setCourses(data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch courses');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createCourse = useCallback(async (courseData: CourseCreate) => {
    try {
      const newCourse = await courseService.createCourse(courseData);
      setCourses(prev => [newCourse, ...prev]);
      return { success: true, data: newCourse };
    } catch (err: any) {
      return { 
        success: false, 
        error: err.response?.data?.error || 'Failed to create course' 
      };
    }
  }, []);

  const updateCourse = useCallback(async (id: number, courseData: Partial<CourseCreate>) => {
    try {
      const updatedCourse = await courseService.updateCourse(id, courseData);
      setCourses(prev => 
        prev.map(c => c.id === id ? updatedCourse : c)
      );
      return { success: true, data: updatedCourse };
    } catch (err: any) {
      return { 
        success: false, 
        error: err.response?.data?.error || 'Failed to update course' 
      };
    }
  }, []);

  const deleteCourse = useCallback(async (id: number) => {
    try {
      await courseService.deleteCourse(id);
      setCourses(prev => prev.filter(c => c.id !== id));
      return { success: true };
    } catch (err: any) {
      return { 
        success: false, 
        error: err.response?.data?.error || 'Failed to delete course' 
      };
    }
  }, []);

  useEffect(() => {
    fetchCourses();
  }, [fetchCourses]);

  return {
    courses,
    isLoading,
    error,
    fetchCourses,
    createCourse,
    updateCourse,
    deleteCourse
  };
};
