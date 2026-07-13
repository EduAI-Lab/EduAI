import { useLocalUser } from '~/hooks/useLocalUser';
import { HelpView } from '~/components/help/HelpView';
import { useShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbContext';
import { requireClientUser } from '~/lib/client-auth';
import type { Route } from './+types/help';

export async function clientLoader(_: Route.ClientLoaderArgs) {
  await requireClientUser();
}

export default function HelpPage() {
  const { user } = useLocalUser();

  useShellBreadcrumbs([{ label: 'Help' }]);

  return <HelpView role={user?.role} />;
}
