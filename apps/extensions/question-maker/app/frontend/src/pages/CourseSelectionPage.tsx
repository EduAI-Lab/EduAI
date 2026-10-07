/**
 * Course selection page shown after login. User must select a course card to continue to Question Bank / Assessments.
 * Same header as homepage; content shows "Your Courses", "Add new course" card, and available course cards.
 */
import { useNavigate } from "react-router";
import { useAutoStartTour } from "@eduai/ui";
import { useAuth } from "@/contexts/AuthContext";
import { CoursesRoleView } from "@/components/courses/courses-role-view";
import { CoursesUnitAdminView } from "@/components/courses/courses-unit-admin-view";
import { useDisplayCourses } from "../hooks/useDisplayCourses";
import { Course } from "../types/question";

export const CourseSelectionPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { displayCourses, isLoading: isCoursesLoading } = useDisplayCourses();

  const handleSelectCourse = (course: Course) => {
    // Push (not replace) so the browser Back button returns to the dashboard.
    navigate(`/courses/${course.id}?tab=overview`);
  };

  // First visit: walk a new user through the guided tour (#1754), once the
  // course list has something to point at.
  useAutoStartTour("main", { enabled: !isCoursesLoading });

  const gridProps = {
    courses: displayCourses,
    isLoading: isCoursesLoading,
    onSelectCourse: handleSelectCourse,
  };

  if (user?.role === "ADMIN") {
    return <CoursesRoleView role="admin" {...gridProps} />;
  }
  if (user?.role === "UNIT_ADMIN") {
    return <CoursesUnitAdminView {...gridProps} />;
  }
  return <CoursesRoleView role="instructor" {...gridProps} />;
};
