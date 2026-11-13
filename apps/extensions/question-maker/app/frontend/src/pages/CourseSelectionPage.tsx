/** Course list: picks the admin, unit-admin, or instructor view by role. */
import { useAuth } from "@/contexts/AuthContext";
import { CoursesRoleView } from "@/components/courses/courses-role-view";
import { CoursesUnitAdminView } from "@/components/courses/courses-unit-admin-view";
import { useDisplayCourses } from "../hooks/useDisplayCourses";

export const CourseSelectionPage = () => {
  const { user } = useAuth();
  const { displayCourses, isLoading: isCoursesLoading } = useDisplayCourses();

  const gridProps = {
    courses: displayCourses,
    isLoading: isCoursesLoading,
  };

  if (user?.role === "ADMIN") {
    return <CoursesRoleView role="admin" {...gridProps} />;
  }
  if (user?.role === "UNIT_ADMIN") {
    return <CoursesUnitAdminView {...gridProps} />;
  }
  return <CoursesRoleView role="instructor" {...gridProps} />;
};
