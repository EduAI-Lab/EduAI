import { DashboardView } from "~/components/dashboard/dashboard-view";

export function DashboardInstructorView() {
  return (
    <DashboardView
      heading="Instructor dashboard"
      subheading="Manage your courses, materials, and student interactions."
      actions={[
        {
          title: "My Courses",
          description: "Edit course details, materials, topics, and enrollments.",
          href: "/courses",
        },
        {
          title: "Course Chat",
          description: "Start course-scoped AI conversations with your classes.",
          href: "/chat",
        },
        {
          title: "Settings",
          description: "Manage your API keys and provider preferences.",
          href: "/settings",
        },
      ]}
    />
  );
}
