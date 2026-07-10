/**
 * Per-user Settings page: Appearance + Accessibility for everyone, plus an
 * Admin tab gated to `canAccessAdminConsole` (mirrors Core's tabbed
 * `settings-view.tsx`, scaled to what AI Tutor actually has today).
 *
 * Deliberately does NOT reuse the shared `AccessibilitySettings` component
 * (`@eduai/ui`) wholesale: that component bundles Theme + Density + Reduce
 * motion + Assistive Mode into one card, but AI Tutor only has working CSS
 * for Theme (Tailwind `dark:` via next-themes) and the Assistive Mode
 * attribute contract. Density (`[data-density]`) and Reduce motion
 * (`[data-reduce-motion]`) are Core-app-local CSS with no AI Tutor
 * equivalent, so wiring those switches here would ship controls that visibly
 * do nothing. Appearance/Accessibility below are small local compositions of
 * the same shared primitives instead, matching Core's copy and layout for
 * the pieces that *do* work.
 */
import { useState } from 'react';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  PageTabs,
  PageTabsContent,
  PageTabsList,
  PageTabsTrigger,
  RadioGroup,
  RadioGroupItem,
  Switch,
  useTheme,
  type AccessibilityUiTheme,
} from '@eduai/ui';
import { IconAccessible, IconPalette, IconShieldLock } from '@tabler/icons-react';

import { AdminSettingsPanel } from '~/components/admin/AdminSettingsPanel';
import { useAssistiveMode } from '~/components/settings/assistive-mode';
import { getApiKeySourceTag, type AdminSettingsLoaderData } from '~/lib/admin-settings';
import type { EduAiApiKeyStatus } from '~/lib/types';

const THEME_CHOICE_CLASS =
  'cursor-pointer flex items-center gap-2 rounded-md border border-border p-3 transition-colors has-[[data-state=checked]]:bg-accent has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-accent';

interface SettingsViewProps {
  isAdmin: boolean;
  adminData: AdminSettingsLoaderData | null;
}

// `getApiKeySourceTag` (shared with admin.tsx) still returns a legacy `.tag`
// className alongside its label; here we only borrow the label text and pick
// a DS Badge variant so this accessory matches the one admin.tsx renders
// instead of the old CSS-class pill.
function sourceTagBadgeVariant(status: EduAiApiKeyStatus): 'default' | 'secondary' | 'outline' {
  if (!status.configured) return 'outline';
  if (status.source === 'ADMIN') return 'default';
  if (status.source === 'ENV') return 'secondary';
  return 'outline';
}

export function SettingsView({ isAdmin, adminData }: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState('appearance');
  const { theme: nextTheme, setTheme } = useTheme();
  const { assistive, setAssistive } = useAssistiveMode();

  const theme = (nextTheme as AccessibilityUiTheme | undefined) ?? 'system';
  const sourceTag = adminData ? getApiKeySourceTag(adminData.status) : null;
  const showAdminTab = isAdmin && adminData != null;

  return (
    <PageTabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <PageTabsList>
        <PageTabsTrigger value="appearance">
          <IconPalette className="h-4 w-4" /> Appearance
        </PageTabsTrigger>
        <PageTabsTrigger value="accessibility">
          <IconAccessible className="h-4 w-4" /> Accessibility
        </PageTabsTrigger>
        {showAdminTab && (
          <PageTabsTrigger value="admin">
            <IconShieldLock className="h-4 w-4" /> Admin
          </PageTabsTrigger>
        )}
      </PageTabsList>

      <PageTabsContent value="appearance" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Choose how AI Tutor looks on this device.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-base">Theme</Label>
              <p className="text-sm text-muted-foreground">
                Match your device or choose light or dark.
              </p>
            </div>
            <RadioGroup
              value={theme}
              onValueChange={(value) => setTheme(value)}
              className="grid gap-2 sm:grid-cols-3"
            >
              <Label htmlFor="theme-system" className={THEME_CHOICE_CLASS}>
                <RadioGroupItem value="system" id="theme-system" />
                <span className="font-normal">System</span>
              </Label>
              <Label htmlFor="theme-light" className={THEME_CHOICE_CLASS}>
                <RadioGroupItem value="light" id="theme-light" />
                <span className="font-normal">Light</span>
              </Label>
              <Label htmlFor="theme-dark" className={THEME_CHOICE_CLASS}>
                <RadioGroupItem value="dark" id="theme-dark" />
                <span className="font-normal">Dark</span>
              </Label>
            </RadioGroup>
          </CardContent>
        </Card>
      </PageTabsContent>

      <PageTabsContent value="accessibility" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Accessibility</CardTitle>
            <CardDescription>
              Personalize how AI Tutor looks and feels. These settings are optional for everyone.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="assistive-mode" className="text-base">
                  Assistive Mode
                </Label>
                <p className="text-sm text-muted-foreground">
                  Optional reading and focus enhancements across EduAI.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Switch
                  id="assistive-mode"
                  checked={assistive}
                  onCheckedChange={(checked) => setAssistive(Boolean(checked))}
                  aria-label="Assistive Mode"
                />
                <Label
                  htmlFor="assistive-mode"
                  className="text-sm font-normal text-muted-foreground whitespace-nowrap cursor-pointer"
                >
                  {assistive ? 'On' : 'Off'}
                </Label>
              </div>
            </div>
          </CardContent>
        </Card>
      </PageTabsContent>

      {showAdminTab && (
        <PageTabsContent value="admin" className="space-y-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-lg font-semibold text-foreground">AI Tutor admin configuration</h2>
              <p className="text-sm text-muted-foreground">
                Configure AI Tutor loop policy and EduAI API integration.
              </p>
            </div>
            {sourceTag && adminData && (
              <Badge variant={sourceTagBadgeVariant(adminData.status)}>{sourceTag.label}</Badge>
            )}
          </div>
          <AdminSettingsPanel loaderData={adminData} />
        </PageTabsContent>
      )}
    </PageTabs>
  );
}
