import { DashboardView } from "~/components/dashboard/dashboard-view";

export function DashboardTaView() {
  return (
    <DashboardView
      heading="TA dashboard"
      subheading="Support instructors by uploading materials and assisting students."
      actions={[
        {
          title: "Assigned Courses",
          description: "View courses where you are a teaching assistant.",
          href: "/courses",
        },
        {
          title: "Course Chat",
          description: "Help students through course-scoped AI chat.",
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
