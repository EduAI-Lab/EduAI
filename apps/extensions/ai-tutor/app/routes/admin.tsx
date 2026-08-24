/**
 * @file Admin console — bug-report triage, AI tutoring configuration, and AI oversight.
 *
 * Route: /admin
 * Auth: ADMIN only. The console is platform administration — bug-report triage,
 *       platform AI configuration, and cross-course AI oversight — and none of
 *       it is a unit administrator's job. UNIT_ADMIN used to be admitted here
 *       with the tab list collapsed to AI oversight; that is gone, and a unit
 *       admin now gets the same in-shell 404 as any other role. `getNavForUser`
 *       has always gated the sidebar entry on `canAccessAdminConsole()`
 *       (ADMIN-only), so the route and the navigation finally agree.
 * Loads: bug reports to triage, admin AI settings (loop policy, model policy,
 *        EduAI API key status), and recent AI interaction traces.
 * Owns: the single admin surface. User/enrollment management is owned by EduAI
 *       Core (synced from Canvas); it is intentionally not exposed here. AI
 *       configuration used to live in Settings → Admin — it now lives here so
 *       there is one admin home, not two.
 * Related: server/src/routes/admin.js, app/lib/admin-settings.ts,
 *   app/components/admin/AiOversightPanel.tsx
 */
import { useState } from "react";
import {
  Badge,
  PageHeading,
  PageTabs,
  PageTabsContent,
  PageTabsList,
  PageTabsTrigger,
} from "@eduai/ui";
import { IconBrain, IconBug, IconSettings } from "@tabler/icons-react";
import BugReportsTab from "~/components/admin/BugReportsTab";
import { AdminSettingsPanel } from "~/components/admin/AdminSettingsPanel";
import { AiOversightPanel } from "~/components/admin/AiOversightPanel";
import api, { type AiTraceRow } from "~/lib/api";
import type { AdminBugReportRow, EduAiApiKeyStatus, Role } from "~/lib/types";
import type { Route } from "./+types/admin";
import { requireClientUser } from "~/lib/client-auth";
import { useShellBreadcrumbs } from "~/components/layout/ShellBreadcrumbContext";
import {
  getApiKeySourceTag,
  loadAdminSettingsData,
  type AdminSettingsLoaderData,
} from "~/lib/admin-settings";
import { RouteErrorState } from "~/components/common/RouteErrorState";

const ADMIN_ROLES: Role[] = ["ADMIN"];

type AdminLoaderData = {
  adminSettings: AdminSettingsLoaderData;
  bugReports: AdminBugReportRow[];
  aiTraces: AiTraceRow[];
};

// Borrow only the source-tag label and render it as a DS Badge (the shared
// helper still returns a legacy `.tag` className we don't use here).
function sourceTagBadgeVariant(status: EduAiApiKeyStatus): "default" | "secondary" | "outline" {
  if (!status.configured) return "outline";
  if (status.source === "ADMIN") return "default";
  if (status.source === "ENV") return "secondary";
  return "outline";
}

export async function clientLoader(_: Route.ClientLoaderArgs) {
  await requireClientUser(ADMIN_ROLES);

  const [adminSettings, bugReports, aiTraces] = await Promise.all([
    loadAdminSettingsData(),
    api.listAdminBugReports(),
    api.adminAiTraces({ limit: 50 }),
  ]);

  return { adminSettings, bugReports, aiTraces } satisfies AdminLoaderData;
}

export default function AdminHome({ loaderData }: Route.ComponentProps) {
  const { adminSettings, bugReports, aiTraces } = loaderData;
  const [activeTab, setActiveTab] = useState("bug-reports");
  // Seeded from the loader, then kept in step with saves/clears inside the
  // panel — the loader is not revalidated, so reading it directly left the
  // badge claiming ".env" after an override had been saved.
  const [keyStatus, setKeyStatus] = useState<EduAiApiKeyStatus | null>(adminSettings.status);
  const sourceTag = keyStatus ? getApiKeySourceTag(keyStatus) : null;

  useShellBreadcrumbs([{ label: "Admin" }]);

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-8 lg:px-6">
      <PageHeading
        heading="Admin console"
        subheading="Triage bug reports, configure AI tutoring, and review AI oversight."
      />

      <PageTabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <PageTabsList>
          <PageTabsTrigger value="bug-reports">
            <IconBug className="h-4 w-4" /> Bug reports
          </PageTabsTrigger>
          <PageTabsTrigger value="ai-settings">
            <IconSettings className="h-4 w-4" /> AI settings
          </PageTabsTrigger>
          <PageTabsTrigger value="ai-oversight">
            <IconBrain className="h-4 w-4" /> AI oversight
          </PageTabsTrigger>
        </PageTabsList>

        <PageTabsContent value="bug-reports" className="space-y-6">
          <BugReportsTab initialReports={bugReports} />
        </PageTabsContent>

        {sourceTag ? (
          <PageTabsContent value="ai-settings" className="space-y-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <h2 className="text-lg font-semibold text-foreground">AI configuration</h2>
                <p className="text-sm text-muted-foreground">
                  Configure the AI loop policy and EduAI API integration.
                </p>
              </div>
              <Badge variant={sourceTagBadgeVariant(keyStatus ?? adminSettings.status)}>
                {sourceTag.label}
              </Badge>
            </div>
            <AdminSettingsPanel loaderData={adminSettings} onStatusChange={setKeyStatus} />
          </PageTabsContent>
        ) : null}

        <PageTabsContent value="ai-oversight" className="space-y-6">
          <AiOversightPanel initialTraces={aiTraces} />
        </PageTabsContent>
      </PageTabs>
    </div>
  );
}

/**
 * A missing record, a malformed id, or a route this role may not open all land
 * on the generic 404 inside the shell — see `RouteErrorState`.
 */
export { RouteErrorState as ErrorBoundary };
