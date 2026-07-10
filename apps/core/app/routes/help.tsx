import { redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { AppSidebar } from "~/components/app-sidebar";
import { HelpView } from "~/components/help/help-view";
import { SiteHeader } from "~/components/site-header";
import { SidebarInset, SidebarProvider } from "@eduai/ui";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return redirect("/auth/login");
  }
  return { user: session.user };
}

export default function HelpPage() {
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
      <AppSidebar user={user} />
      <SidebarInset>
        <SiteHeader title="Help & guide" />
        <HelpView role={user.role ?? undefined} />
      </SidebarInset>
    </SidebarProvider>
  );
}
