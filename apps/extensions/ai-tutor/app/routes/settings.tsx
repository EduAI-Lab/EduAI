import { PageHeading } from '@eduai/ui';

import { AdminSettingsPanel } from '~/components/admin/AdminSettingsPanel';
import { AppShell } from '~/components/layout/AppShell';
import { ShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbs';
import { requireClientUser } from '~/lib/client-auth';
import { getApiKeySourceTag, loadAdminSettingsData } from '~/lib/admin-settings';
import type { Route } from './+types/settings';

export async function clientLoader(_: Route.ClientLoaderArgs) {
  await requireClientUser('ADMIN');
  return loadAdminSettingsData();
}

export default function SettingsPage({ loaderData }: Route.ComponentProps) {
  const sourceTag = getApiKeySourceTag(loaderData.status);

  return (
    <AppShell breadcrumbs={<ShellBreadcrumbs items={[{ label: 'Settings' }]} />}>
      <div className="space-y-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <PageHeading
            heading="Settings"
            subheading="Configure AI Tutor loop policy and EduAI API integration."
          />
          <div className={sourceTag.className}>{sourceTag.label}</div>
        </div>

        <AdminSettingsPanel loaderData={loaderData} />
      </div>
    </AppShell>
  );
}
