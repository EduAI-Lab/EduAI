import { PageHeading } from '@eduai/ui';

import { SettingsView } from '~/components/settings/settings-view';
import { useShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbContext';
import { requireClientUser } from '~/lib/client-auth';
import { canAccessAdminConsole } from '~/lib/rbac/permissions';
import { loadAdminSettingsData, type AdminSettingsLoaderData } from '~/lib/admin-settings';
import type { Route } from './+types/settings';

export async function clientLoader(_: Route.ClientLoaderArgs) {
  // Any authenticated user may reach Settings now (Appearance + Accessibility
  // are per-user); the Admin tab and its data stay gated to admins only.
  const user = await requireClientUser();
  const isAdmin = canAccessAdminConsole(user);
  const adminData: AdminSettingsLoaderData | null = isAdmin ? await loadAdminSettingsData() : null;
  return { isAdmin, adminData };
}

export default function SettingsPage({ loaderData }: Route.ComponentProps) {
  useShellBreadcrumbs([{ label: 'Settings' }]);

  return (
    <div className="space-y-8">
      <PageHeading
        heading="Settings"
        subheading="Manage your appearance and accessibility preferences."
      />

      <SettingsView isAdmin={loaderData.isAdmin} adminData={loaderData.adminData} />
    </div>
  );
}
