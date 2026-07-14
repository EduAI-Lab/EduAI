import { SettingsView } from '~/components/settings/settings-view';
import { useShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbContext';
import { requireClientUser } from '~/lib/client-auth';
import type { Route } from './+types/settings';

export async function clientLoader(_: Route.ClientLoaderArgs) {
  // Any authenticated user may reach Settings — every tab is per-user
  // (Account, Accessibility, Providers). Admin-only AI configuration lives
  // on the `/admin` console.
  await requireClientUser();
  return {};
}

export default function SettingsPage() {
  useShellBreadcrumbs([{ label: 'Settings' }]);

  return <SettingsView />;
}
