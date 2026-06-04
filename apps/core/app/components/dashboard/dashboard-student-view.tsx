import { DashboardView } from "~/components/dashboard/dashboard-view";

export function DashboardStudentView() {
  return (
    <DashboardView
      heading="Student dashboard"
      subheading="Access your enrolled courses and AI study tools."
      actions={[
        {
          title: "My Courses",
          description: "View published course materials and topics.",
          href: "/courses",
        },
        {
          title: "Course Chat",
          description: "Ask questions in the context of your enrolled courses.",
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
