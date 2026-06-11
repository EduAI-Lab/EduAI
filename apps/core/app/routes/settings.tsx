import { redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { AppSidebar } from "~/components/app-sidebar";
import { SettingsView } from "~/components/settings/settings-view";
import { SiteHeader } from "~/components/site-header";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);
  if (!session?.user) {
    return redirect("/auth/login");
  }

  return { user: session.user };
}

export default function SettingsPage() {
  const { user } = useLoaderData<typeof loader>();

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" user={user} />
      <SidebarInset>
        <SettingsView role={user.role} />
      </SidebarInset>
    </SidebarProvider>
  );
}
