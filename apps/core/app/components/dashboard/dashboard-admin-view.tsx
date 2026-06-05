import { DashboardView } from "~/components/dashboard/dashboard-view";

export function DashboardAdminView() {
  return (
    <DashboardView
      heading="Platform admin dashboard"
      subheading="Manage users, AI configuration, and platform-wide settings."
      actions={[
        {
          title: "User Management",
          description: "Create, edit, and deactivate platform accounts.",
          href: "/admin/users",
        },
        {
          title: "AI Management",
          description: "Configure providers and models for the whole platform.",
          href: "/admin/ai-models",
        },
        {
          title: "Bug Reports",
          description: "Review and triage reports from all EduAI apps.",
          href: "/admin/bug-reports",
        },
        {
          title: "Courses",
          description: "View and manage courses across the platform.",
          href: "/courses",
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
