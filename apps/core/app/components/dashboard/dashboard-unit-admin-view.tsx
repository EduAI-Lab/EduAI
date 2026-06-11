import { DashboardView } from "~/components/dashboard/dashboard-view";

export function DashboardUnitAdminView() {
  return (
    <DashboardView
      heading="Unit admin dashboard"
      subheading="Manage courses and content within your authorized units."
      actions={[
        {
          title: "Courses",
          description: "Create and manage courses in your authorized departments.",
          href: "/courses",
        },
        {
          title: "Chatbot",
          description: "Use global chat for unit-wide support and questions.",
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
