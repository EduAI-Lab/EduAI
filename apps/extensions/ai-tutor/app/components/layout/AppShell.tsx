import { SidebarInset, SidebarProvider } from '@eduai/ui';

import { useLocalUser } from '~/hooks/useLocalUser';
import { AiTutorSidebar } from './AiTutorSidebar';
import { AppSiteHeader } from './AppSiteHeader';
import { CommandPalette } from '~/components/command/CommandPalette';

export type AppShellProps = {
  children: React.ReactNode;
  breadcrumbs?: React.ReactNode;
  actions?: React.ReactNode;
};

/**
 * Authenticated app chrome: persistent left sidebar + top header matching EduAI Core.
 * Week 7 #629 — replaces per-route `<Nav />` top bar.
 */
export function AppShell({ children, breadcrumbs, actions }: AppShellProps) {
  const { user } = useLocalUser();

  if (!user) {
    return <>{children}</>;
  }

  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 72)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as React.CSSProperties
      }
    >
      <AiTutorSidebar user={user} />
      <SidebarInset>
        <AppSiteHeader breadcrumbs={breadcrumbs} actions={actions} />
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0 md:gap-6 md:p-6">{children}</div>
      </SidebarInset>
      <CommandPalette />
    </SidebarProvider>
  );
}
