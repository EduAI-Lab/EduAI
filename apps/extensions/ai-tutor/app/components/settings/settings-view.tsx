/**
 * Per-user Settings — Account + Accessibility + Providers (BYOK), matching
 * the dense, tabbed pattern used by Core's `settings-view.tsx` and Question
 * Maker's `SettingsPage.tsx`. Admin-only AI configuration is NOT here; it
 * lives on the `/admin` console alongside bug-report triage.
 *
 * Accessibility now composes the shared `AccessibilitySettings` component
 * (`@eduai/ui`) directly, same as Core and Question Maker. Density and
 * reduce-motion have no dedicated CSS in AI Tutor yet (only Core's
 * `app.css` wires `[data-density]` / `[data-reduce-motion]` today) — this
 * mirrors Question Maker's own settings page, which ships the same two
 * toggles as session-only attribute state ahead of shared CSS landing.
 * Assistive Mode is passed through unchanged: it is BREB-approved and its
 * `[data-assistive] .reading-surface` contract (see
 * `~/components/settings/assistive-mode.tsx`) must not be touched.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AccessibilitySettings,
  Avatar,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeading,
  PageTabs,
  PageTabsContent,
  PageTabsList,
  PageTabsTrigger,
  RoleBadge,
  SignOutCard,
  useTheme,
  type AccessibilityUiDensity,
  type AccessibilityUiTheme,
} from '@eduai/ui';
import { IconAccessible, IconLogout, IconUser, IconWorld } from '@tabler/icons-react';

import { useAssistiveMode } from '~/components/settings/assistive-mode';
import { ProvidersSettings } from '~/components/settings/providers-settings';
import { useLocalUser } from '~/hooks/useLocalUser';

function readInitialDensity(): AccessibilityUiDensity {
  if (typeof document === 'undefined') return 'comfortable';
  return document.documentElement.getAttribute('data-density') === 'compact'
    ? 'compact'
    : 'comfortable';
}

function readInitialMotionReduced(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.hasAttribute('data-reduce-motion');
}

export function SettingsView() {
  const [activeTab, setActiveTab] = useState('account');
  const { user, logout } = useLocalUser();
  const navigate = useNavigate();
  const { theme: nextTheme, setTheme } = useTheme();
  const { assistive, setAssistive } = useAssistiveMode();
  const [density, setDensity] = useState<AccessibilityUiDensity>(readInitialDensity);
  const [motionReduced, setMotionReduced] = useState<boolean>(readInitialMotionReduced);

  const theme = (nextTheme as AccessibilityUiTheme | undefined) ?? 'system';

  const handleDensityChange = (value: AccessibilityUiDensity) => {
    setDensity(value);
    if (value === 'compact') {
      document.documentElement.setAttribute('data-density', 'compact');
    } else {
      document.documentElement.removeAttribute('data-density');
    }
  };

  const handleMotionReducedChange = (value: boolean) => {
    setMotionReduced(value);
    if (value) {
      document.documentElement.setAttribute('data-reduce-motion', 'true');
    } else {
      document.documentElement.removeAttribute('data-reduce-motion');
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <div className="@container/main flex flex-1 flex-col gap-8 px-4 pt-6 pb-8 lg:px-6">
      <PageHeading
        heading="Settings"
        subheading="Manage your account, accessibility preferences, and AI provider keys."
      />

      <PageTabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <PageTabsList>
          <PageTabsTrigger value="account">
            <IconUser className="h-4 w-4" /> Account
          </PageTabsTrigger>
          <PageTabsTrigger value="accessibility">
            <IconAccessible className="h-4 w-4" /> Accessibility
          </PageTabsTrigger>
          <PageTabsTrigger value="providers">
            <IconWorld className="h-4 w-4" /> Providers
          </PageTabsTrigger>
        </PageTabsList>

        <PageTabsContent value="account" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>Your account details for this AI Tutor session.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <Avatar name={user?.name ?? 'You'} size={48} radius={12} />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate text-sm font-medium">{user?.name ?? 'Signed in'}</p>
                  {user?.email && (
                    <p className="truncate text-sm text-muted-foreground">{user.email}</p>
                  )}
                </div>
                {user?.role && <RoleBadge role={user.role} className="shrink-0" />}
              </div>
            </CardContent>
          </Card>
        </PageTabsContent>

        <PageTabsContent value="accessibility" className="space-y-6">
          <AccessibilitySettings
            theme={theme}
            density={density}
            motionReduced={motionReduced}
            assistive={assistive}
            onThemeChange={(value) => setTheme(value)}
            onDensityChange={handleDensityChange}
            onMotionReducedChange={handleMotionReducedChange}
            onAssistiveChange={setAssistive}
            description="Personalize how AI Tutor looks and feels. These settings are optional for everyone."
          />
        </PageTabsContent>

        <PageTabsContent value="providers" className="space-y-6">
          <ProvidersSettings />
        </PageTabsContent>
      </PageTabs>

      <SignOutCard
        action={
          <Button type="button" variant="outline" onClick={() => void handleLogout()}>
            <IconLogout className="h-4 w-4" /> Log out
          </Button>
        }
      />
    </div>
  );
}
