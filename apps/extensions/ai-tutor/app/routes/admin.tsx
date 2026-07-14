/**
 * @file Admin console — bug-report triage, AI tutoring configuration, and AI oversight.
 *
 * Route: /admin
 * Auth: ADMIN and UNIT_ADMIN. Bug reports + AI settings stay ADMIN-only (they
 *       touch platform-wide config/PII); AI oversight is visible to both, since
 *       unit admins need to audit AI tutoring within their own unit too.
 * Loads: bug reports to triage + admin AI settings (loop policy, model policy,
 *        EduAI API key status) for ADMIN; recent AI interaction traces for both
 *        roles.
 * Owns: the single admin surface. User/enrollment management is owned by EduAI
 *       Core (synced from Canvas); it is intentionally not exposed here. AI
 *       configuration used to live in Settings → Admin — it now lives here so
 *       there is one admin home, not two.
 * Related: server/src/routes/admin.js, app/lib/admin-settings.ts,
 *   app/components/admin/AiOversightPanel.tsx
 */
import { useState } from 'react';
import {
  Badge,
  PageHeading,
  PageTabs,
  PageTabsContent,
  PageTabsList,
  PageTabsTrigger,
} from '@eduai/ui';
import { IconBrain, IconBug, IconSettings } from '@tabler/icons-react';
import BugReportsTab from '~/components/admin/BugReportsTab';
import { AdminSettingsPanel } from '~/components/admin/AdminSettingsPanel';
import { AiOversightPanel } from '~/components/admin/AiOversightPanel';
import api, { type AiTraceRow } from '~/lib/api';
import type { AdminBugReportRow, EduAiApiKeyStatus, Role } from '~/lib/types';
import type { Route } from './+types/admin';
import { requireClientUser } from '~/lib/client-auth';
import { useShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbContext';
import {
  getApiKeySourceTag,
  loadAdminSettingsData,
  type AdminSettingsLoaderData,
} from '~/lib/admin-settings';

const ADMIN_ROLES: Role[] = ['ADMIN', 'UNIT_ADMIN'];

type AdminLoaderData = {
  role: Role;
  adminSettings: AdminSettingsLoaderData | null;
  bugReports: AdminBugReportRow[] | null;
  aiTraces: AiTraceRow[];
};

// Borrow only the source-tag label and render it as a DS Badge (the shared
// helper still returns a legacy `.tag` className we don't use here).
function sourceTagBadgeVariant(status: EduAiApiKeyStatus): 'default' | 'secondary' | 'outline' {
  if (!status.configured) return 'outline';
  if (status.source === 'ADMIN') return 'default';
  if (status.source === 'ENV') return 'secondary';
  return 'outline';
}

export async function clientLoader(_: Route.ClientLoaderArgs) {
  const user = await requireClientUser(ADMIN_ROLES);

  // Bug reports + AI settings hit ADMIN-only server routes (403 for
  // UNIT_ADMIN) — only fetch them for ADMIN so a unit admin's Promise.all
  // doesn't fail wholesale and lock them out of the AI oversight tab.
  const isAdmin = user.role === 'ADMIN';

  const [adminSettings, bugReports, aiTraces] = await Promise.all([
    isAdmin ? loadAdminSettingsData() : Promise.resolve(null),
    isAdmin ? api.listAdminBugReports() : Promise.resolve(null),
    api.adminAiTraces({ limit: 50 }),
  ]);

  return { role: user.role, adminSettings, bugReports, aiTraces } satisfies AdminLoaderData;
}

export default function AdminHome({ loaderData }: Route.ComponentProps) {
  const { role, adminSettings, bugReports, aiTraces } = loaderData;
  const isAdmin = role === 'ADMIN';
  const [activeTab, setActiveTab] = useState(isAdmin ? 'bug-reports' : 'ai-oversight');
  const sourceTag = adminSettings ? getApiKeySourceTag(adminSettings.status) : null;

  useShellBreadcrumbs([{ label: 'Admin' }]);

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-8 lg:px-6">
      <PageHeading
        heading="Admin console"
        subheading={
          isAdmin
            ? 'Triage bug reports, configure AI tutoring, and review AI oversight.'
            : 'Review AI tutoring activity in your unit.'
        }
      />

      <PageTabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <PageTabsList>
          {isAdmin ? (
            <PageTabsTrigger value="bug-reports">
              <IconBug className="h-4 w-4" /> Bug reports
            </PageTabsTrigger>
          ) : null}
          {isAdmin ? (
            <PageTabsTrigger value="ai-settings">
              <IconSettings className="h-4 w-4" /> AI settings
            </PageTabsTrigger>
          ) : null}
          <PageTabsTrigger value="ai-oversight">
            <IconBrain className="h-4 w-4" /> AI oversight
          </PageTabsTrigger>
        </PageTabsList>

        {isAdmin && bugReports ? (
          <PageTabsContent value="bug-reports" className="space-y-6">
            <BugReportsTab initialReports={bugReports} />
          </PageTabsContent>
        ) : null}

        {isAdmin && adminSettings && sourceTag ? (
          <PageTabsContent value="ai-settings" className="space-y-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <h2 className="text-lg font-semibold text-foreground">AI configuration</h2>
                <p className="text-sm text-muted-foreground">
                  Configure the AI loop policy and EduAI API integration.
                </p>
              </div>
              <Badge variant={sourceTagBadgeVariant(adminSettings.status)}>{sourceTag.label}</Badge>
            </div>
            <AdminSettingsPanel loaderData={adminSettings} />
          </PageTabsContent>
        ) : null}

        <PageTabsContent value="ai-oversight" className="space-y-6">
          <AiOversightPanel initialTraces={aiTraces} />
        </PageTabsContent>
      </PageTabs>
    </div>
  );
}
